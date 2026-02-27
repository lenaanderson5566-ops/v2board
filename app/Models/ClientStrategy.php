<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ClientStrategy extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_client_strategy';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'is_enabled' => 'boolean',
        'sort' => 'integer',
        'min_version' => 'string',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
    ];
}
