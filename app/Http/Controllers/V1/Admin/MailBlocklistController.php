<?php
namespace App\Http\Controllers\V1\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Crypt,DB};
use App\Services\{MailBlocklist,MailDeliveryLog};

class MailBlocklistController extends \App\Http\Controllers\Controller
{
    public function fetch(Request $request)
    {
        $p=$request->validate(['email'=>'nullable|string|email:rfc|max:254','state'=>'nullable|in:active,released,all','current'=>'nullable|integer|min:1|max:100000','page_size'=>'nullable|integer|min:1|max:100']);
        $query=DB::table('v2_mail_blocklist');
        if (!empty($p['email'])) $query->where('recipient_hash',MailDeliveryLog::recipientHash($p['email']));
        $state=$p['state'] ?? 'active';
        if ($state==='active') $query->whereNull('released_at');
        if ($state==='released') $query->whereNotNull('released_at');
        $total=(clone $query)->count();
        $rows=$query->orderByDesc('updated_at')->orderBy('recipient_hash')->forPage($p['current'] ?? 1,$p['page_size'] ?? 20)->get()->map(function($row){
            try { $email=Crypt::decryptString($row->email_encrypted); } catch (\Throwable $e) { $email='地址不可解密，请检查 APP_KEY'; }
            return ['recipient_hash'=>$row->recipient_hash,'email'=>$email,'note'=>$row->note,'revision'=>(int)$row->revision,'administrator_id'=>$row->administrator_id,'created_at'=>$row->created_at,'updated_at'=>$row->updated_at,'released_at'=>$row->released_at];
        });
        return response(['data'=>$rows,'total'=>$total])->header('Cache-Control','no-store');
    }

    public function add(Request $request)
    {
        $email=$request->input('email'); $note=$request->input('note');
        $request->merge(['email'=>is_string($email) ? strtolower(trim($email)):$email,'note'=>is_string($note) ? trim($note):$note]);
        $p=$request->validate(['email'=>'required|string|email:rfc|max:254','note'=>'nullable|string|max:1000']);
        MailBlocklist::add($p['email'],$p['note'] ?? '',(int)$request->user['id']);
        return response(['data'=>true],201);
    }

    public function import(Request $request)
    {
        $p=$request->validate(['emails'=>'required|array|min:1|max:200','emails.*'=>'required|string|max:254','note'=>'nullable|string|max:1000']);
        $emails=array_map(static function($email){ return strtolower(trim($email)); },$p['emails']);
        validator(['emails'=>$emails],['emails.*'=>'required|email:rfc|max:254'])->validate();
        $unique=array_values(array_unique($emails));
        sort($unique);
        $added=DB::transaction(function() use($unique,$p,$request){
            $count=0;
            foreach ($unique as $email) {
                if (MailBlocklist::add($email,trim($p['note'] ?? ''),(int)$request->user['id'],true)) $count++;
            }
            return $count;
        },3);
        return response(['data'=>['added'=>$added,'skipped'=>count($unique)-$added,'duplicates'=>count($emails)-count($unique)]],201)->header('Cache-Control','no-store');
    }

    public function change(Request $request)
    {
        $p=$request->validate(['recipient_hash'=>'required|string|regex:/^[a-f0-9]{64}$/D','revision'=>'required|integer|min:1','action'=>'required|in:note,release','note'=>'nullable|string|max:1000']);
        $note=$p['action']==='note' ? trim($p['note'] ?? '') : null;
        MailBlocklist::change($p['recipient_hash'],(int)$p['revision'],$p['action'],$note,(int)$request->user['id']);
        return response(['data'=>true]);
    }

    public function history(Request $request)
    {
        $p=$request->validate(['recipient_hash'=>'required|string|regex:/^[a-f0-9]{64}$/D','current'=>'nullable|integer|min:1|max:100000','page_size'=>'nullable|integer|min:1|max:100']);
        $q=DB::table('v2_mail_blocklist_audit')->where('recipient_hash',$p['recipient_hash']);
        return response(['total'=>(clone $q)->count(),'data'=>$q->orderByDesc('id')->forPage($p['current'] ?? 1,$p['page_size'] ?? 20)->get(['id','administrator_id','action','created_at'])])->header('Cache-Control','no-store');
    }
}
