<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\MailLog;
use App\Services\MailDeliveryLog;
use Illuminate\Http\Request;

class MailLogController extends Controller
{
    public function fetch(Request $request)
    {
        $p = $request->validate([
            'stream'=>'nullable|in:transactional,announcement', 'delivery_status'=>'nullable|in:delivered,temporary,rejected,bounced,complained,unsubscribed',
            'current'=>'nullable|integer|min:1|max:100000', 'page_size'=>'nullable|integer|min:1|max:100',
            'email'=>'nullable|string|email:rfc|max:254', 'provider'=>'nullable|in:smtp,mailgun,ses,resend',
            'status'=>'nullable|in:sending,accepted,failed,uncertain,skipped,legacy',
            'transport_code'=>'nullable|integer|min:100|max:599',
            'enhanced_code'=>'nullable|string|regex:/^[45]\.[0-9]{1,3}\.[0-9]{1,3}$/D',
            'template'=>'nullable|string|max:64', 'from'=>'nullable|integer|min:0', 'to'=>'nullable|integer|min:0',
        ]);
        if (isset($p['from'], $p['to']) && $p['from']>$p['to']) abort(422, '结束时间不能早于开始时间');
        $q = MailLog::query();
        if (!empty($p['email'])) $q->where(function ($q) use ($p) {
            $q->where('recipient_hash', MailDeliveryLog::recipientHash($p['email']))
                ->orWhere(function ($q) use ($p) { $q->whereNull('recipient_hash')->where('email', $p['email']); });
        });
        if (!empty($p['provider'])) $q->where('provider', $p['provider']);
        if (!empty($p['status'])) {
            if ($p['status'] === 'legacy') $q->whereNull('status');
            elseif ($p['status'] === 'uncertain') $q->where(function ($q) {
                $q->where('status', 'uncertain')->orWhere(function ($q) { $q->where('status','sending')->where('created_at','<',time()-120); });
            });
            elseif ($p['status'] === 'sending') $q->where('status','sending')->where('created_at','>=',time()-120);
            else $q->where('status', $p['status']);
        }
        if (!empty($p['template'])) $q->whereIn('template_name', [$p['template'], 'mail.product.'.$p['template']]);
        if (isset($p['from'])) $q->where('created_at', '>=', $p['from']);
        if (isset($p['to'])) $q->where('created_at', '<=', $p['to']);
        foreach (['stream','delivery_status','transport_code','enhanced_code'] as $field) if (isset($p[$field])) $q->where($field,$p[$field]);
        $total = (clone $q)->count();
        $rows = $q->orderByDesc('created_at')->orderByDesc('id')->forPage($p['current'] ?? 1, $p['page_size'] ?? 20)
            ->get(['stream','delivery_status','delivery_at','transport_code','enhanced_code','user_id','id','email','template_name','provider','status','error_code','message_id','duration_ms','created_at']);
        return response(['total'=>$total, 'data'=>$rows->map(function ($row) {
            $status = $row->status ?: 'legacy';
            if ($status === 'sending' && $row->created_at < time()-120) $status = 'uncertain';
            [$category,$advice] = \App\Services\MailDiagnosis::advice($status,$row->error_code,$row->transport_code,$row->enhanced_code);
            return ['stream'=>$row->stream, 'delivery_status'=>$row->delivery_status, 'delivery_at'=>$row->delivery_at, 'transport_code'=>$row->transport_code, 'enhanced_code'=>$row->enhanced_code, 'user_id'=>$row->user_id, 'diagnosis'=>$category, 'advice'=>$advice, 'id'=>$row->id, 'email'=>MailDeliveryLog::mask($row->email),
                'template'=>str_replace('mail.product.', '', $row->template_name), 'provider'=>$row->provider ?: 'legacy',
                'status'=>$status, 'error_code'=>$row->error_code, 'message_id'=>$row->message_id,
                'duration_ms'=>$row->duration_ms, 'created_at'=>$row->created_at];
        })]);
    }
    public function health()
    {
        $counts=\Illuminate\Support\Facades\DB::table('v2_mail_log')->where('created_at','>=',time()-86400)->selectRaw('provider, stream, status, delivery_status, count(*) as count')->groupBy('provider','stream','status','delivery_status')->get();
        return response(['data'=>['window_hours'=>24,'counts'=>$counts,'suppressed'=>\Illuminate\Support\Facades\DB::table('v2_mail_suppression')->whereNull('released_at')->count(),'unmatched_events'=>\Illuminate\Support\Facades\DB::table('v2_mail_event')->whereNull('applied_at')->where('created_at','<',time()-300)->where('created_at','>=',time()-86400)->count()]]);
    }
    public function suppressions(Request $request)
    {
        $p=$request->validate(['current'=>'nullable|integer|min:1|max:100000','email'=>'nullable|string|email:rfc|max:254']);
        $q=\Illuminate\Support\Facades\DB::table('v2_mail_suppression')->whereNull('released_at');
        if (!empty($p['email'])) $q->where('recipient_hash',MailDeliveryLog::recipientHash($p['email']));
        $total=(clone $q)->count();
        return response(['total'=>$total,'data'=>$q->orderByDesc('updated_at')->forPage($p['current'] ?? 1,20)->get(['recipient_hash','email','reason','updated_at'])]);
    }
    public function release(Request $request)
    {
        $p=$request->validate(['recipient_hash'=>'required|string|size:64|regex:/^[a-f0-9]+$/D','verified'=>'required|accepted']);
        \Illuminate\Support\Facades\DB::transaction(function() use($p) {
            $q=\Illuminate\Support\Facades\DB::table('v2_mail_suppression')->where('recipient_hash',$p['recipient_hash']);
            $row=(clone $q)->lockForUpdate()->first(); abort_unless($row,404);
            abort_if($row->reason==='complained',422,'投诉地址不能在此直接恢复，请先完成服务商申诉与用户授权核查。');
            $q->update(['released_at'=>time()]);
        });
        info('Mail suppression reviewed',['administratorId'=>$request->user['id'] ?? null,'recipientHash'=>$p['recipient_hash'],'action'=>'release']);
        return response(['data'=>true]);
    }
}
