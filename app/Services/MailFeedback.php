<?php
namespace App\Services;
use App\Models\MailLog;
use Illuminate\Support\Facades\DB;
class MailFeedback
{
    public const RANK=['temporary'=>1,'delivered'=>2,'rejected'=>3,'unsubscribed'=>4,'bounced'=>5,'complained'=>6];
    public function record(string $provider, string $eventId, string $messageId, string $email, string $state, int $at): void
    {
        if (!isset(self::RANK[$state]) || !preg_match('/^[A-Za-z0-9@._<>+\-]{1,255}$/D',$messageId) || strlen($eventId)>255 || $eventId==='' || $at<1 || $at>time()+300 || validator(['email'=>$email],['email'=>'required|email:rfc|max:254'])->fails()) abort(422,'Invalid mail event');
        $hash=MailDeliveryLog::recipientHash($email);
        DB::table('v2_mail_event')->insertOrIgnore(['event_key'=>hash('sha256',$provider.'|'.$eventId.'|'.$hash),'provider'=>$provider,'message_id'=>trim($messageId,'<>'),'recipient_hash'=>$hash,'state'=>$state,'occurred_at'=>$at,'created_at'=>time()]);
        $logs=MailLog::where('provider',$provider)->whereIn('message_id',[$messageId,trim($messageId,'<>'),'<'.trim($messageId,'<>').'>'])->where('recipient_hash',$hash)->get();
        foreach ($logs as $log) $this->reconcile($log);
    }
    public function reconcile(MailLog $log): void
    {
        if (!$log->message_id) return;
        DB::transaction(function() use($log) {
            $row=MailLog::whereKey($log->id)->lockForUpdate()->first();
            if (!$row) return;
            $events=DB::table('v2_mail_event')->where('provider',$row->provider)->where('message_id',trim($row->message_id,'<>'))->where('recipient_hash',$row->recipient_hash)->orderBy('id')->lockForUpdate()->get();
            foreach ($events as $event) {
                if ((self::RANK[$event->state] ?? 0)>(self::RANK[$row->delivery_status] ?? 0)) {
                    $row->delivery_status=$event->state; $row->delivery_at=$event->occurred_at;
                }
                if ($event->applied_at) continue;
                if (in_array($event->state,['bounced','complained'],true)) {
                    DB::table('v2_mail_suppression')->insertOrIgnore(['recipient_hash'=>$row->recipient_hash,'email'=>$row->email,'reason'=>$event->state,'created_at'=>time(),'updated_at'=>$event->occurred_at]);
                    $suppression=DB::table('v2_mail_suppression')->where('recipient_hash',$row->recipient_hash)->lockForUpdate()->first();
                    if ((!$suppression->released_at || $event->occurred_at>$suppression->released_at) && $event->occurred_at>=$suppression->updated_at) {
                        DB::table('v2_mail_suppression')->where('recipient_hash',$row->recipient_hash)->update(['reason'=>$suppression->reason==='complained' ? 'complained' : $event->state,'released_at'=>null,'updated_at'=>$event->occurred_at]);
                    }
                }
                if ($event->state==='unsubscribed' && $row->user_id) {
                    $user=\App\Models\User::find($row->user_id);
                    if ($user && hash_equals($row->recipient_hash,MailDeliveryLog::recipientHash($user->email))) $user->update(['announcement_email'=>0]);
                }
                DB::table('v2_mail_event')->where('id',$event->id)->update(['applied_at'=>time()]);
            }
            $row->save();
            DB::table('v2_mail_campaign_recipient')->where('mail_log_id',$row->id)->update(['delivery_status'=>$row->delivery_status,'status'=>'accepted']);
        },3);
    }
}
