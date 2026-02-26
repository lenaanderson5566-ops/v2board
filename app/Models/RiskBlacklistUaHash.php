<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiskBlacklistUaHash extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_risk_blacklist_ua_hash';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'is_enabled' => 'boolean',
        'ua_raw' => 'string',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
    ];
}
