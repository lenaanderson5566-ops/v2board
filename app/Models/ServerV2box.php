<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ServerV2box extends Model
{
    protected $table = 'v2_server_v2box';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'sing_box' => 'array',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'group_id' => 'array',
        'route_id' => 'array',
        'tags' => 'array',
        'tls_settings' => 'array',
        'network_settings' => 'array',
        'trusted_x_forwarded_for' => 'array',
        'encryption_settings' => 'array',
        'padding_scheme' => 'array',
    ];
}
