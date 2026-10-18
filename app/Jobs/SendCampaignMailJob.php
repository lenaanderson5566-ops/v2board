<?php
namespace App\Jobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use App\Services\Mail\MailCampaign;
use App\Services\Mail\MailDeliveryLog;
class SendCampaignMailJob implements ShouldQueue {
    use Dispatchable,InteractsWithQueue,Queueable,SerializesModels;
    public $tries=1; public $timeout=60;
    public function __construct(public int $recipientId) { $this->onConnection('redis'); $this->onQueue('send_email_mass'); }
    public function handle(): void {
        $row=DB::transaction(function(){
            $row=DB::table('v2_mail_campaign_recipient')->where('id',$this->recipientId)->lockForUpdate()->first();
            if(!$row || $row->status!=='queued' || $row->available_at>time()) return null;
            DB::table('v2_mail_campaign_recipient')->where('id',$row->id)->update(['status'=>'sending','updated_at'=>time()]); return $row;
        });
        if(!$row) return;
        $q=DB::table('v2_mail_campaign_recipient')->where('id',$row->id);
        try {
            $campaign=DB::table('v2_mail_campaign')->find($row->campaign_id); $user=\App\Models\User::find($row->user_id);
            $reason=!$campaign || $campaign->expires_at<=time() ? 'expired' : (!$user || !hash_equals($row->recipient_hash,MailDeliveryLog::recipientHash($user->email)) ? 'recipient_changed' : MailCampaign::reason($user,$campaign->purpose));
            if($reason) { $q->update(['status'=>'skipped','reason'=>$reason,'updated_at'=>time()]); return; }
            $result=(new SendEmailJob(['email'=>$user->email,'subject'=>$campaign->subject,'template_name'=>'notify','mail_purpose'=>$campaign->purpose,'campaign_recipient_id'=>$row->id,'source_language'=>$campaign->source_language,'translations'=>json_decode($campaign->translations,true),'expires_at'=>$campaign->expires_at,'template_value'=>['content'=>$campaign->content]],'send_email_mass'))->handle();
            if(isset($result['deferred'])) { $q->update(['status'=>'queued','scheduled_at'=>0,'available_at'=>time()+max(1,(int)$result['deferred']),'updated_at'=>time()]); return; }
            $status=!empty($result['skipped']) ? 'skipped' : (!empty($result['error']) ? 'failed':'accepted');
            $log=!empty($result['log_id']) ? DB::table('v2_mail_log')->find($result['log_id']) : null;
            if($log && ($log->status==='uncertain' || ($status==='failed' && $log->provider==='smtp' && empty($result['permanent'])))) $status='uncertain';
            // SMTP network outcomes cannot safely be automatically retried.
            $retry=$status==='failed' && $log && $log->provider!=='smtp' && empty($result['permanent']) && $row->attempts<4;
            $q->update(['status'=>$retry ? 'queued':$status,'scheduled_at'=>0,'reason'=>$result['reason'] ?? ($result['error'] ?? null),'mail_log_id'=>$result['log_id'] ?? null,'attempts'=>$row->attempts+1,'available_at'=>time()+300,'updated_at'=>time()]);
        } catch(\Throwable $e) {
            // A worker interruption may occur after delivery. Leave ambiguous attempts for review.
            $q->update(['status'=>'uncertain','reason'=>'processing_interrupted','updated_at'=>time()]);
        }
    }
}
