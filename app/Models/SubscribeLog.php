<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SubscribeLog extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_subscribe_log';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'expired_at' => 'timestamp',
        'traffic_u' => 'integer',
        'traffic_d' => 'integer',
        'traffic_total' => 'integer',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp'
    ];
}
