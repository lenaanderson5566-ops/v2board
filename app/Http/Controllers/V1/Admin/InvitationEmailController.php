<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\Mail\MailDeliveryLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
class InvitationEmailController extends Controller
{
    public function fetch(Request $request)
    {
        $p = $request->validate([
            'current'=>'nullable|integer|min:1|max:100000', 'page_size'=>'nullable|integer|min:1|max:100',
            'inviter'=>'nullable|string|email:rfc|max:254', 'recipient'=>'nullable|string|email:rfc|max:254',
            'state'=>'nullable|in:accepted,pending,expired',
        ]);
        $q=DB::table('v2_email_invitation as i')->leftJoin('v2_user as u','u.id','=','i.user_id')->leftJoin('v2_mail_log as m','m.id','=','i.mail_log_id');
        if (!empty($p['inviter'])) $q->where('u.email',strtolower(trim($p['inviter'])));
        if (!empty($p['recipient'])) $q->where('i.email_hash',hash('sha256',strtolower(trim($p['recipient']))));
        if (($p['state'] ?? '')==='accepted') $q->whereNotNull('i.accepted_at');
        if (in_array($p['state'] ?? '',['pending','expired'],true)) $q->whereNull('i.accepted_at')->where('i.expires_at', $p['state']==='pending' ? '>' : '<=',time());
        $total=(clone $q)->count();
        $rows=$q->orderByDesc('i.last_requested_at')->orderByDesc('i.id')->forPage($p['current'] ?? 1,$p['page_size'] ?? 20)
            ->get(['i.id','i.user_id','u.email as inviter_email','i.email','i.last_requested_at','i.expires_at','i.accepted_at','i.accepted_user_id','i.sent_at','i.failed_at','m.status','m.delivery_status','m.error_code','m.created_at as attempt_at']);
        return response(['total'=>$total,'data'=>$rows->map(function($r){
            $status=$r->status ?: ($r->failed_at ? 'failed' : ($r->sent_at ? 'legacy' : 'queued'));
            if ($status==='sending' && $r->attempt_at<time()-120) $status='uncertain';
            return ['id'=>$r->id,'user_id'=>$r->user_id,'inviter_email'=>$r->inviter_email ? MailDeliveryLog::mask($r->inviter_email) : null,
                'email'=>MailDeliveryLog::mask($r->email),'requested_at'=>$r->last_requested_at,'expires_at'=>$r->expires_at,
                'accepted_at'=>$r->accepted_at,'accepted_user_id'=>$r->accepted_user_id,
                'state'=>$r->accepted_at ? 'accepted' : ($r->expires_at<=time() ? 'expired' : 'pending'),
                'status'=>$status,'delivery_status'=>$r->delivery_status,'error_code'=>$r->error_code];
        })]);
    }
}
