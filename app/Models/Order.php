<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $table = 'v2_order';
    protected $attributes = ['currency' => 'CNY'];
    protected static function booted() {
        static::updating(function ($order) {
            if ($order->isDirty('currency')) throw new \InvalidArgumentException('Order currency cannot be changed');
        });
        static::creating(function ($order) {
            if (!in_array($order->currency, ['CNY','USD'], true)) throw new \InvalidArgumentException('Unsupported order currency');
        });
    }
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $hidden = ['payment_snapshot', 'fx_snapshot'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'surplus_order_ids' => 'array',
        'credit_snapshot' => 'array',
        'payment_snapshot' => 'array',
        'fx_snapshot' => 'array',
        'credit_bytes' => 'integer'
    ];
}
