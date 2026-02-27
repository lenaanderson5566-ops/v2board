<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserConnectionLog extends Model
{
    protected $table = 'v2_user_connection_log';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'connected_at' => 'integer',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
    ];
}
