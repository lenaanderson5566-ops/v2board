<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiskRuleHit extends Model
{
    use \App\Scope\FilterScope;

    protected $table = 'v2_risk_rule_hit';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'payload' => 'array',
        'hit_at' => 'timestamp',
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp'
    ];
}
