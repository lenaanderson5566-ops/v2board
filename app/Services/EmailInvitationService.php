<?php
namespace App\Services;

use App\Jobs\SendInvitationEmailJob;
use App\Models\EmailInvitation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

class EmailInvitationService
{
    public function send(int $userId, string $email): EmailInvitation
    {
        $email = strtolower(trim($email));
        $url = rtrim((string)config('v2board.app_url'), '/');
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(parse_url($url, PHP_URL_SCHEME), ['http','https'], true)) abort(422, __('Configure the site URL before sending invitations.'));
        if (config('v2board.stop_register', 0)) abort(422, __('Registration has closed'));
        $token = bin2hex(random_bytes(32));
        $record = DB::transaction(function () use ($userId, $email, $token) {
            $sender = User::where('id', $userId)->lockForUpdate()->firstOrFail();
            if ($sender->banned) abort(403, __('Your account is restricted.'));
            if (strtolower($sender->email) === $email) abort(422, __('You cannot invite yourself.'));
            if (User::where('email', $email)->exists()) abort(422, __('This email already has an account.'));
            $record = EmailInvitation::where('user_id', $userId)->where('email_hash', hash('sha256',$email))->lockForUpdate()->first();
            if ($record && $record->accepted_at) abort(422, __('This invitation has already been accepted.'));
            if ($record && $record->last_requested_at > time()-60) abort(429, __('Please wait a minute before resending.'));
            $key = 'email-invitation:'.$userId;
            if (RateLimiter::tooManyAttempts($key, 20)) abort(429, __('The daily invitation limit has been reached.'));
            $pending = EmailInvitation::where('user_id',$userId)->whereNull('accepted_at')->where('expires_at','>',time());
            if ($record) $pending->where('id','!=',$record->id);
            if ($pending->count() >= max(0, (int)config('v2board.invite_gen_limit',5))) abort(422, __('The maximum number of creations has been reached'));
            $record = $record ?: new EmailInvitation(['user_id'=>$userId,'email'=>$email,'email_hash'=>hash('sha256',$email)]);
            $record->fill(['token_hash'=>hash('sha256',$token),'expires_at'=>time()+7*86400,'last_requested_at'=>time(),'sent_at'=>null,'failed_at'=>null]);
            $record->save();
            RateLimiter::hit($key, 86400);
            return $record;
        });
        try { SendInvitationEmailJob::dispatch($record->id, $token); }
        catch (\Throwable $error) { $record->update(['failed_at'=>time()]); throw $error; }
        return $record;
    }

    public function register(string $token, string $email, callable $createUser): User
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) abort(422, __('The email invitation is invalid or expired.'));
        return DB::transaction(function () use ($token, $email, $createUser) {
            $invitation = EmailInvitation::where('token_hash',hash('sha256',$token))->lockForUpdate()->first();
            if (!$invitation || $invitation->accepted_at || $invitation->expires_at <= time() || $invitation->email !== strtolower(trim($email))) abort(422, __('The email invitation is invalid or expired.'));
            $sender = User::find($invitation->user_id);
            if (!$sender || $sender->banned) abort(422, __('The email invitation is invalid or expired.'));
            $user = $createUser($invitation->user_id);
            $invitation->update(['accepted_user_id'=>$user->id,'accepted_at'=>time()]);
            return $user;
        });
    }

    public function history(int $userId, int $days): array
    {
        return EmailInvitation::where('user_id',$userId)->where('updated_at','>=',time()-$days*86400)->orderBy('updated_at','desc')->orderBy('id','desc')->limit(100)->get()->map(function ($record) {
            return ['id'=>$record->id,'email'=>$record->email,'created_at'=>$record->created_at,'expires_at'=>$record->expires_at,'status'=>$record->accepted_at?'accepted':($record->expires_at<=time()?'expired':($record->failed_at?'failed':($record->sent_at?'sent':'queued')))];
        })->all();
    }
}
