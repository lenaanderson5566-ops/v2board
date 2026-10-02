<?php
namespace App\Jobs;

use App\Models\EmailInvitation;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendInvitationEmailJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    public $tries = 3;
    public $timeout = 30;
    public $invitationId;
    public $token;
    public $language;
    public function __construct($invitationId, $token) { $this->invitationId=$invitationId; $this->token=$token; $this->language=app()->getLocale(); $this->onQueue('send_email'); }
    public function handle()
    {
        $record = EmailInvitation::find($this->invitationId);
        if (!$record || $record->accepted_at || $record->expires_at<=time() || !hash_equals($record->token_hash,hash('sha256',$this->token))) return;
        $sender = User::find($record->user_id);
        if (!$sender || $sender->banned) { $record->update(['failed_at'=>time()]); return; }
        $name = config('v2board.app_name','Studio');
        $link = rtrim(config('v2board.app_url'),'/').'/app#/register?invitation='.rawurlencode($this->token).'&email='.rawurlencode($record->email);
        $locale = app()->getLocale();
        try {
            app()->setLocale($this->language);
            $result = (new SendEmailJob(['email'=>$record->email,'subject'=>__('You are invited to :name',['name'=>$name]),'template_name'=>'emailInvitation','template_value'=>['name'=>$name,'url'=>$link,'expires_at'=>$record->expires_at]]))->handle();
        } finally { app()->setLocale($locale); }
        $update = EmailInvitation::where('id',$record->id)->where('token_hash',$record->token_hash)->whereNull('accepted_at');
        if (!empty($result['error'])) { $update->update(['failed_at'=>time()]); throw new \RuntimeException('Invitation email delivery failed.'); }
        $update->update(['sent_at'=>time(),'failed_at'=>null]);
    }

    public function failed($error)
    {
        EmailInvitation::where('id', $this->invitationId)
            ->where('token_hash', hash('sha256', $this->token))
            ->whereNull('accepted_at')->whereNull('sent_at')
            ->update(['failed_at' => time()]);
    }
}
