<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserOnlineSnapshot extends Model
{
    protected $table = 'v2_user_online_snapshot';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'online_at' => 'integer',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
    ];
}
