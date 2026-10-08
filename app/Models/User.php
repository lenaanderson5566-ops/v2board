<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    protected $table = 'v2_user';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'remind_service' => 'boolean',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'credit_balance' => 'integer'
    ];
    public function getCreditBalanceAttribute($value)
    {
        if (!$value || !$this->exists) return (int)$value;
        $expired=\Illuminate\Support\Facades\DB::table('v2_credit_batch')->where('user_id',$this->id)->where('expires_at','<=',time())->sum('remaining_bytes');
        return max(0,(int)$value-(int)$expired);
    }
    public function scopeWithUsableTraffic($query)
    {
        return $query->where('banned', 0)->where(function ($q) {
            $q->whereRaw(\App\Services\CreditExpiryService::usableSql().' > 0')->orWhere(function ($base) {
                $base->whereRaw('u + d < transfer_enable')->where(function ($expiry) {
                    $expiry->whereNull('expired_at')->orWhere('expired_at', '>', time());
                });
            });
        });
    }
}
