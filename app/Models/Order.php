<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $table = 'v2_order';
    protected $attributes = ['currency' => 'CNY'];
    protected static function booted() {
        static::creating(function ($order) {
            if ($order->currency !== 'CNY') throw new \InvalidArgumentException('Only CNY orders are enabled');
        });
    }
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'surplus_order_ids' => 'array',
        'credit_snapshot' => 'array',
        'credit_bytes' => 'integer'
    ];
}
