<?php
use App\Services\MailCampaign;
use App\Jobs\SendCampaignMailJob;
use Illuminate\Support\Facades\{DB,Http,Crypt,Schema};
$serviceUser=App\Models\User::create(['email'=>'campaign@example.test','banned'=>0,'announcement_email'=>0]);
$q=App\Models\User::where('id',$serviceUser->id);
$assert(MailCampaign::preview($q,'service')['eligible']===1 && MailCampaign::preview($q,'marketing')['not_subscribed']===1,'Service/marketing eligibility conflated');
$data=['request_key'=>(string)Illuminate\Support\Str::uuid(),'purpose'=>'service','subject'=>'Maintenance','content'=>'Service maintenance content','translations'=>[]];
$campaign=MailCampaign::create($q,$data,1);
$recipient=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$campaign)->first();
config(['v2board.email_provider'=>'resend','v2board.email_from_address'=>'service@example.test','v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST'),'v2board.email_announcement_separate'=>1,'v2board.email_announcements_enabled'=>0]);
$fakeHttp(['*'=>Http::response(['id'=>'campaign-message'],200)]);
(new SendCampaignMailJob($recipient->id))->handle();
$sent=DB::table('v2_mail_campaign_recipient')->find($recipient->id);
$assert($sent->status==='accepted','Necessary service notice blocked by marketing preference');
Http::assertSent(fn($r)=>!isset($r['headers']['List-Unsubscribe']) && str_contains($r['from'],'service@example.test'));$checks++;
(new SendCampaignMailJob($recipient->id))->handle();Http::assertSentCount(1);$checks++;
$assert(MailCampaign::stats($campaign)['delivery_rate']===0.0,'Campaign acceptance denominator incorrect');
(new App\Services\MailFeedback)->record('resend','campaign-delivered','campaign-message',$serviceUser->email,'delivered',time());
$assert(MailCampaign::stats($campaign)['delivered']===1 && MailCampaign::stats($campaign)['delivery_rate']===100.0,'Campaign callback statistics missing');
$assert(MailCampaign::create($q,$data,1)===$campaign,'Repeated submission created duplicate campaign');
$data['request_key']=(string)Illuminate\Support\Str::uuid();$data['purpose']='marketing';$marketing=MailCampaign::create($q,$data,1);
$assert(MailCampaign::stats($marketing)['skipped']===1,'Marketing silently enrolled unsubscribed users');
$data['request_key']=(string)Illuminate\Support\Str::uuid();$data['purpose']='service';$changed=MailCampaign::create($q,$data,1);$r=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$changed)->first();$serviceUser->update(['email'=>'changed@example.test']);
(new SendCampaignMailJob($r->id))->handle();$assert(DB::table('v2_mail_campaign_recipient')->find($r->id)->reason==='recipient_changed','Campaign followed changed recipient address');
DB::table('v2_mail_campaign_recipient')->where('id',$r->id)->update(['status'=>'sending','updated_at'=>time()-700]);
(new App\Console\Commands\ProcessMailCampaigns)->handle();$assert(DB::table('v2_mail_campaign_recipient')->find($r->id)->status==='uncertain','Interrupted campaign automatically replayed');
// Private ticket replies are merged per ticket, with owner-scoped versioned read receipts.
Schema::create('v2_ticket',function($t){$t->bigIncrements('id');$t->unsignedBigInteger('user_id');});
Schema::create('v2_ticket_message',function($t){$t->bigIncrements('id');$t->unsignedBigInteger('ticket_id');$t->unsignedBigInteger('user_id');$t->unsignedInteger('created_at');});
$ticket=DB::table('v2_ticket')->insertGetId(['user_id'=>$serviceUser->id]);
$mine=DB::table('v2_ticket_message')->insertGetId(['ticket_id'=>$ticket,'user_id'=>$serviceUser->id,'created_at'=>time()]);
$otherTicket=DB::table('v2_ticket')->insertGetId(['user_id'=>999999]);
DB::table('v2_ticket_message')->insert(['ticket_id'=>$otherTicket,'user_id'=>1,'created_at'=>time()]);
$action=new App\Services\Actions\User\TicketNotificationActions;
$assert($action->inbox($serviceUser->id)['unread']===0,'Other users ticket or own message leaked into inbox');
$reply=DB::table('v2_ticket_message')->insertGetId(['ticket_id'=>$ticket,'user_id'=>1,'created_at'=>time()]);
$reply2=DB::table('v2_ticket_message')->insertGetId(['ticket_id'=>$ticket,'user_id'=>1,'created_at'=>time()]);
$assert($action->inbox($serviceUser->id)['unread']===1 && $action->inbox($serviceUser->id)['items'][0]['message_id']===$reply2,'Ticket replies not coalesced');
$req=fn($id,$version)=>Illuminate\Http\Request::create('/','POST',['id'=>$id,'version'=>$version,'user'=>['id'=>$serviceUser->id]]);
$reject(fn()=>$action->read($req($otherTicket,$reply)),404);
$reject(fn()=>$action->read($req($ticket,$mine)),422);
$action->read($req($ticket,$reply));$assert($action->inbox($serviceUser->id)['unread']===1,'Old read acknowledged newer reply');
$action->read($req($ticket,$reply2));$action->read($req($ticket,$reply));$assert($action->inbox($serviceUser->id)['unread']===0,'Read receipt regressed');
$assert(DB::table('v2_ticket_notification_read')->count()===1,'Read receipt not idempotent');
echo "PASS campaign purpose, recipient dedupe, feedback stats, interruption recovery and private ticket receipts\n";

// Concurrent queue duplicates must claim a recipient only once.
if($mysql && function_exists('pcntl_fork')) {
 $data['request_key']=(string)Illuminate\Support\Str::uuid();$data['purpose']='service';$parallelId=MailCampaign::create($q,$data,1);
 $parallelRecipient=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$parallelId)->first();
 $before=DB::table('v2_mail_log')->count();$fakeHttp(['*'=>Http::response(['id'=>'parallel-campaign'],200)]);
 DB::disconnect('notification_test');$children=[];
 for($i=0;$i<2;$i++) { $pid=pcntl_fork();if($pid===-1)throw new RuntimeException('Fork failed');if($pid===0){DB::purge('notification_test');(new SendCampaignMailJob($parallelRecipient->id))->handle();exit(0);}$children[]=$pid; }
 foreach($children as $pid){pcntl_waitpid($pid,$status);$assert(pcntl_wexitstatus($status)===0,'Campaign contender failed');}
 DB::purge('notification_test');
 $assert(DB::table('v2_mail_log')->count()===$before+1 && DB::table('v2_mail_campaign_recipient')->find($parallelRecipient->id)->status==='accepted','Concurrent campaign duplicate sent more than once');
 echo "PASS concurrent MySQL campaign recipient claim\n";
}
