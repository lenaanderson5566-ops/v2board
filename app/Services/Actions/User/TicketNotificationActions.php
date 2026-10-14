<?php
namespace App\Services\Actions\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
class TicketNotificationActions {
    public function inbox(int $userId): array {
        $latest=DB::table('v2_ticket_message as m')->join('v2_ticket as t','t.id','=','m.ticket_id')->where('t.user_id',$userId)->whereColumn('m.user_id','<>','t.user_id')->selectRaw('m.ticket_id, MAX(m.id) as message_id')->groupBy('m.ticket_id');
        $q=DB::query()->fromSub($latest,'latest')->join('v2_ticket_message as m','m.id','=','latest.message_id')->leftJoin('v2_ticket_notification_read as r',function($join) use($userId){$join->on('r.ticket_id','=','latest.ticket_id')->where('r.user_id',$userId);})->where(function($query){$query->whereNull('r.message_id')->orWhereColumn('r.message_id','<','latest.message_id');});
        $unread=(clone $q)->count();
        $items=$q->orderByDesc('m.id')->limit(20)->get(['latest.ticket_id','latest.message_id','m.created_at'])->map(fn($r)=>['ticket_id'=>(int)$r->ticket_id,'message_id'=>(int)$r->message_id,'created_at'=>(int)$r->created_at])->all();
        return ['items'=>$items,'unread'=>$unread];
    }
    public function read(Request $request) {
        $data=$request->validate(['id'=>'required|integer|min:1','version'=>'required|integer|min:1']);
        return DB::transaction(function() use($request,$data){
            $ticket=DB::table('v2_ticket')->where('id',$data['id'])->where('user_id',$request->user['id'])->lockForUpdate()->first(); abort_unless($ticket,404);
            abort_unless(DB::table('v2_ticket_message')->where('id',$data['version'])->where('ticket_id',$ticket->id)->where('user_id','<>',$ticket->user_id)->exists(),422);
            $old=DB::table('v2_ticket_notification_read')->where('ticket_id',$ticket->id)->first();
            DB::table('v2_ticket_notification_read')->updateOrInsert(['ticket_id'=>$ticket->id],['user_id'=>$ticket->user_id,'message_id'=>max((int)($old->message_id ?? 0),$data['version']),'read_at'=>time()]);
            return response(['data'=>true]);
        });
    }
}
