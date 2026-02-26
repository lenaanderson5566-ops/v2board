<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiskRuleConfig extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_risk_rule_config';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'thresholds' => 'array',
        'enabled' => 'boolean',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp'
    ];
}
