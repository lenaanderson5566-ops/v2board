<?php
namespace App\Http\Controllers\V1\Admin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Services\Mail\MailCampaign;
class MailCampaignController extends \App\Http\Controllers\Controller {
    public function fetch(Request $request) {
        $request->validate(['page_size'=>'sometimes|integer|min:1|max:100','current'=>'sometimes|integer|min:1|max:100000','id'=>'sometimes|integer|min:1']);
        if($request->input('id')) {
            $row=DB::table('v2_mail_campaign')->find($request->integer('id')); abort_unless($row,404);
            $row->translations=json_decode($row->translations,true);
            return response(['data'=>['campaign'=>$row,'stats'=>MailCampaign::stats($row->id)]]);
        }
        $q=DB::table('v2_mail_campaign'); $total=$q->count();
        $rows=$q->select('id','subject','purpose','administrator_id','created_at')->orderByDesc('id')->forPage($request->integer('current',1),$request->integer('page_size',20))->get();
        foreach($rows as $row) $row->stats=MailCampaign::stats($row->id);
        return response(['data'=>$rows,'total'=>$total]);
    }
}
