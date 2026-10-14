<?php
namespace App\Console\Commands;
class ProcessMailFeedback extends \Illuminate\Console\Command
{
    protected $signature='mail:feedback';
    protected $description='Reconcile early mail events and prune bounded event metadata';
    public function handle(): int
    {
        $events=\Illuminate\Support\Facades\DB::table('v2_mail_event')->whereNull('applied_at')->where('created_at','>=',time()-86400)
            // Unmatched external events must not starve recoverable local deliveries.
            ->whereExists(function ($query) {
                $query->selectRaw('1')->from('v2_mail_log')
                    ->whereColumn('v2_mail_log.provider','v2_mail_event.provider')
                    ->whereColumn('v2_mail_log.recipient_hash','v2_mail_event.recipient_hash')
                    ->whereRaw("REPLACE(REPLACE(v2_mail_log.message_id, '<', ''), '>', '') = v2_mail_event.message_id");
            })->orderBy('id')->limit(200)->get();
        foreach($events as $event) {
            $logs=\App\Models\MailLog::where('provider',$event->provider)->where('recipient_hash',$event->recipient_hash)->whereIn('message_id',[$event->message_id,'<'.$event->message_id.'>'])->get();
            foreach($logs as $log) app(\App\Services\MailFeedback::class)->reconcile($log);
        }
        $ids=\Illuminate\Support\Facades\DB::table('v2_mail_event')->where('created_at','<',time()-90*86400)->limit(1000)->pluck('id');
        if ($ids->isNotEmpty()) \Illuminate\Support\Facades\DB::table('v2_mail_event')->whereIn('id',$ids)->delete();
        return 0;
    }
}
