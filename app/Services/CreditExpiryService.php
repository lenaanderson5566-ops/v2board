<?php
namespace App\Services;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class CreditExpiryService
{
    public static function usableSql(): string {
        return '(GREATEST(0, CAST(v2_user.credit_balance AS SIGNED) - COALESCE((SELECT SUM(cb.remaining_bytes) FROM v2_credit_batch cb WHERE cb.user_id=v2_user.id AND cb.expires_at <= '.time().'),0)))';
    }
    // Caller owns the user lock and transaction. Keep cached balance and batches atomic.
    public static function grant(User $user, int $bytes, string $reference, int $months=12): void {
        if ($bytes<=0) return;
        DB::table('v2_credit_batch')->insert([
            'user_id'=>$user->id,'reference'=>$reference,'remaining_bytes'=>$bytes,
            'expires_at'=>\Carbon\Carbon::now('UTC')->addMonthsNoOverflow($months)->timestamp,'created_at'=>time(),
        ]);
        $user->credit_balance=(int)($user->getAttributes()['credit_balance'] ?? 0)+$bytes;
    }
    public static function expire(User $user): void {
        $rows=DB::table('v2_credit_batch')->where('user_id',$user->id)->where('expires_at','<=',time())->where('remaining_bytes','>',0)->lockForUpdate()->get();
        foreach($rows as $row) {
            DB::table('v2_credit_batch')->where('id',$row->id)->update(['remaining_bytes'=>0]);
            DB::table('v2_traffic_credit_log')->insert([
                'user_id'=>$user->id,'reference'=>'expiry:'.$row->id,'kind'=>'expiry','bytes'=>$row->remaining_bytes,'snapshot'=>json_encode(['expiresAt'=>$row->expires_at]),'created_at'=>time(),
            ]);
            $user->credit_balance=max(0,(int)($user->getAttributes()['credit_balance'] ?? 0)-(int)$row->remaining_bytes);
        }
    }
    public static function consume(User $user, int $bytes): void {
        if ((int)($user->getAttributes()['credit_balance'] ?? 0)<=0) return;
        self::expire($user);
        $debit=min((int)($user->getAttributes()['credit_balance'] ?? 0),max(0,$bytes));
        $remaining=$debit;
        foreach(DB::table('v2_credit_batch')->where('user_id',$user->id)->where('remaining_bytes','>',0)->where('expires_at','>',time())->orderBy('expires_at')->orderBy('id')->lockForUpdate()->get() as $row) {
            $take=min($remaining,(int)$row->remaining_bytes);
            if (!$take) break;
            DB::table('v2_credit_batch')->where('id',$row->id)->update(['remaining_bytes'=>$row->remaining_bytes-$take]);
            $remaining-=$take;
        }
        $user->credit_balance=max(0,(int)($user->getAttributes()['credit_balance'] ?? 0)-$debit);
    }
}
