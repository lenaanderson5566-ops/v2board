<?php
namespace App\Console\Commands;
use Illuminate\Support\Facades\DB;
class ProcessMailCampaigns extends \Illuminate\Console\Command {
    protected $signature='mail:campaigns';
    protected $description='Dispatch durable campaign recipients and recover interrupted attempts';
    public function handle(): int {
        DB::table('v2_mail_campaign_recipient')->where('status','sending')->where('updated_at','<',time()-600)->update(['status'=>'uncertain','reason'=>'worker_interrupted','updated_at'=>time()]);
        $rows=DB::table('v2_mail_campaign_recipient')->where('status','queued')->where('available_at','<=',time())->where('scheduled_at','<',time()-600)->orderBy('available_at')->limit(200)->get();
        foreach($rows as $row) {
            // If dispatch fails or a queue item is lost, the next scheduling window recovers it.
            if(DB::table('v2_mail_campaign_recipient')->where('id',$row->id)->where('status','queued')->where('available_at','<=',time())->where('scheduled_at','<',time()-600)->update(['scheduled_at'=>time()])) \App\Jobs\SendCampaignMailJob::dispatch((int)$row->id);
        }
        return 0;
    }
}
