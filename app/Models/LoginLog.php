<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LoginLog extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_login_log';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'is_success' => 'boolean',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp'
    ];
}
