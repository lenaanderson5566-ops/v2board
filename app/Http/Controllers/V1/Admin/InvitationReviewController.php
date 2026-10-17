<?php
namespace App\Http\Controllers\V1\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class InvitationReviewController extends \App\Http\Controllers\Controller {
    public function fetch(Request $request) {
        $input = $request->validate([
            'current'=>'nullable|integer|min:1', 'pageSize'=>'nullable|integer|min:1|max:100',
            'state'=>'nullable|in:pending,confirmed,false_positive,insufficient,no_signal',
            'keyword'=>'nullable|string|max:128', 'id'=>'nullable|integer|min:1', 'queue'=>'nullable|boolean',
        ]);
        $q = DB::table('v2_invitation_review as r')
            ->leftJoin('v2_user as u','u.id','=','r.user_id')
            ->leftJoin('v2_user as i','i.id','=','r.inviter_id')
            ->leftJoin('v2_plan as up','up.id','=','u.plan_id')
            ->leftJoin('v2_plan as ip','ip.id','=','i.plan_id');
        if (!empty($input['state'])) $q->where('r.state',$input['state']);
        if (!empty($input['id'])) $q->where('r.id',$input['id']);
        // Filter the default queue without rewriting historical decisions or evidence.
        if (!empty($input['queue'])) {
            $q->where('r.state','pending')->where('r.signals->sameRegistrationIp',true);
            $q->orderByRaw("CASE WHEN JSON_EXTRACT(r.signals, '$.sameRegistrationUa') = true THEN 0 ELSE 1 END")
                ->orderBy('r.created_at')->orderBy('r.id');
        } else {
            $q->orderByDesc('r.id');
        }
        if (!empty($input['keyword'])) $q->where(function($query) use($input) {
            $query->where('u.email','like','%'.$input['keyword'].'%')->orWhere('i.email','like','%'.$input['keyword'].'%');
        });
        $total = (clone $q)->count();
        $data = $q->select('r.*','u.email','i.email as inviter_email',
            'u.created_at as user_registered_at','i.created_at as inviter_registered_at',
            'up.name as user_plan_name','ip.name as inviter_plan_name',
            'u.plan_id as user_plan_id','i.plan_id as inviter_plan_id',
            'u.expired_at as user_expired_at','i.expired_at as inviter_expired_at',
            'u.banned as user_banned','i.banned as inviter_banned')
            ->forPage($input['current'] ?? 1,$input['pageSize'] ?? 20)->get();
        $history = DB::table('v2_invitation_review_event')->whereIn('review_id',$data->pluck('id'))
            ->orderByDesc('id')->get()->groupBy('review_id');
        $now = time();
        // Batched aggregates: query count is bounded by page, not by number of rows.
        $invites = DB::table('v2_user')->whereIn('invite_user_id',$data->pluck('inviter_id')->unique())
            ->select('invite_user_id')->selectRaw('COUNT(*) as total')
            ->selectRaw('SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as day_count',[$now-86400])
            ->selectRaw('SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as week_count',[$now-7*86400])
            ->groupBy('invite_user_id')->get()->keyBy('invite_user_id');
        $commissions = DB::table('v2_order')->whereIn('user_id',$data->pluck('user_id'))
            ->whereIn('invite_user_id',$data->pluck('inviter_id'))->whereNotIn('status',[0,2])
            ->where('commission_balance','>',0)->select('user_id','invite_user_id','currency')
            ->selectRaw('SUM(commission_balance) as amount')->groupBy('user_id','invite_user_id','currency')
            ->get()->groupBy(fn($row) => $row->user_id.':'.$row->invite_user_id);
        foreach ($data as $row) {
            $row->signals = json_decode($row->signals,true) ?: [];
            $row->history = $history->get($row->id,collect());
            $counts = $invites->get($row->inviter_id);
            $row->invitation_counts = ['total'=>(int)($counts->total ?? 0),
                'last24Hours'=>(int)($counts->day_count ?? 0),'last7Days'=>(int)($counts->week_count ?? 0),'asOf'=>$now];
            $row->commissions = $commissions->get($row->user_id.':'.$row->inviter_id,collect())
                ->map(fn($item) => ['currency'=>$item->currency ?: 'CNY','amount'=>(int)$item->amount])->values();
        }
        return response()->json(['data'=>$data,'total'=>$total])->header('Cache-Control','no-store');
    }
    public function review(Request $request) {
        if (is_string($request->input('note'))) $request->merge(['note'=>trim($request->input('note'))]);
        $input=$request->validate(['id'=>'required|integer|min:1','revision'=>'required|integer|min:0','state'=>'required|in:confirmed,false_positive,insufficient','note'=>'required|string|min:5|max:1000']);
        DB::transaction(function() use($request,$input) {
            $row=DB::table('v2_invitation_review')->where('id',$input['id'])->lockForUpdate()->first();
            if (!$row) abort(404,'审核记录不存在');
            if ((int)$row->revision !== (int)$input['revision']) abort(409,'记录已更新，请刷新后重试');
            DB::table('v2_invitation_review')->where('id',$row->id)->update(['state'=>$input['state'],'revision'=>$row->revision+1,'updated_at'=>time()]);
            DB::table('v2_invitation_review_event')->insert(['review_id'=>$row->id,'admin_id'=>$request->user['id'],'state'=>$input['state'],'note'=>$input['note'],'created_at'=>time()]);
        });
        return response()->json(['data'=>true]);
    }
}
