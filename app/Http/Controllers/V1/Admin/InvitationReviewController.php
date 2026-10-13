<?php
namespace App\Http\Controllers\V1\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class InvitationReviewController extends \App\Http\Controllers\Controller {
    public function fetch(Request $request) {
        $input=$request->validate(['current'=>'nullable|integer|min:1','pageSize'=>'nullable|integer|min:1|max:100','state'=>'nullable|in:pending,confirmed,false_positive,insufficient,no_signal','keyword'=>'nullable|string|max:128']);
        $q=DB::table('v2_invitation_review as r')->leftJoin('v2_user as u','u.id','=','r.user_id')->leftJoin('v2_user as i','i.id','=','r.inviter_id');
        if (!empty($input['state'])) $q->where('r.state',$input['state']);
        if (!empty($input['keyword'])) $q->where(function($q) use($input) { $q->where('u.email','like','%'.$input['keyword'].'%')->orWhere('i.email','like','%'.$input['keyword'].'%'); });
        $total=(clone $q)->count();
        $data=$q->select('r.*','u.email','i.email as inviter_email')->orderByDesc('r.id')->forPage($input['current'] ?? 1,$input['pageSize'] ?? 20)->get();
        $history=DB::table('v2_invitation_review_event')->whereIn('review_id',$data->pluck('id'))->orderByDesc('id')->get()->groupBy('review_id');
        foreach($data as $row) { $row->signals=json_decode($row->signals,true); $row->history=$history->get($row->id,collect()); }
        return response()->json(['data'=>$data,'total'=>$total]);
    }
    public function review(Request $request) {
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
