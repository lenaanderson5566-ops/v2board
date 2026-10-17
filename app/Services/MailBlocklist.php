<?php
namespace App\Services;

use Illuminate\Support\Facades\{Crypt,DB};

class MailBlocklist
{
    public static function contains(string $email): bool
    {
        return DB::table('v2_mail_blocklist')->where('recipient_hash',MailDeliveryLog::recipientHash($email))->whereNull('released_at')->exists();
    }

    public static function enforce(string $email): void
    {
        if (self::contains($email)) throw new \App\Exceptions\MailSendException('MAIL_MANUALLY_BLOCKED');
    }

    public static function add(string $email,string $note,int $administratorId,bool $skipExisting=false): bool
    {
        $email=strtolower(trim($email));
        $hash=MailDeliveryLog::recipientHash($email);
        return DB::transaction(function() use($email,$note,$administratorId,$hash,$skipExisting){
            if (DB::table('v2_user')->whereRaw('LOWER(email) = ?',[$email])->exists()) {
                throw \Illuminate\Validation\ValidationException::withMessages(['email'=>'该邮箱属于现有用户，不能加入邮件禁发名单。']);
            }
            $inserted=DB::table('v2_mail_blocklist')->insertOrIgnore(['recipient_hash'=>$hash,'email_encrypted'=>Crypt::encryptString($email),'note'=>$note,'administrator_id'=>$administratorId,'created_at'=>time(),'updated_at'=>time()]);
            $query=DB::table('v2_mail_blocklist')->where('recipient_hash',$hash);
            $row=(clone $query)->lockForUpdate()->first();
            if (!$inserted) {
                if ($skipExisting && $row->released_at===null) return false;
                abort_unless($row->released_at,409,'该邮箱已在禁发名单，请使用编辑备注。');
                $query->update(['email_encrypted'=>Crypt::encryptString($email),'note'=>$note,'administrator_id'=>$administratorId,'released_at'=>null,'updated_at'=>time(),'revision'=>$row->revision+1]);
            }
            self::audit($hash,$administratorId,$inserted ? 'add':'reactivate');
            return true;
        },3);
    }

    public static function change(string $hash,int $revision,string $action,?string $note,int $administratorId): void
    {
        DB::transaction(function() use($hash,$revision,$action,$note,$administratorId){
            $query=DB::table('v2_mail_blocklist')->where('recipient_hash',$hash);
            $row=(clone $query)->lockForUpdate()->first();
            abort_unless($row,404);
            abort_unless((int)$row->revision===$revision,409,'记录已被其他管理员修改，请刷新后重试。');
            $values=['updated_at'=>time(),'administrator_id'=>$administratorId,'revision'=>$row->revision+1];
            if ($action==='release') {
                abort_if($row->released_at!==null,409,'该记录已解除。');
                $values['released_at']=time();
            } else $values['note']=$note;
            $query->update($values);
            self::audit($hash,$administratorId,$action);
        },3);
    }

    private static function audit(string $hash,int $administratorId,string $action): void
    {
        DB::table('v2_mail_blocklist_audit')->insert(['recipient_hash'=>$hash,'administrator_id'=>$administratorId,'action'=>$action,'created_at'=>time()]);
    }
}
