<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    protected $table = 'v2_user';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'credit_balance' => 'integer'
    ];
    public function scopeWithUsableTraffic($query)
    {
        return $query->where('banned', 0)->where(function ($q) {
            $q->where('credit_balance', '>', 0)->orWhere(function ($base) {
                $base->whereRaw('u + d < transfer_enable')->where(function ($expiry) {
                    $expiry->whereNull('expired_at')->orWhere('expired_at', '>', time());
                });
            });
        });
    }
}
