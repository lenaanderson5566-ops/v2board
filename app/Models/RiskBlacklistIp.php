<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiskBlacklistIp extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_risk_blacklist_ip';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'is_enabled' => 'boolean',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
    ];
}
