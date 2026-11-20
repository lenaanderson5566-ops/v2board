<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class RiskRuleHit extends Model
{
    use \App\Scope\FilterScope;

    public const REVIEWED_STATES = ['confirmed', 'false_positive', 'ignored'];

    public function scopePendingReview(Builder $query): Builder
    {
        return $query->where(fn ($state) => $state->whereNull('payload->review->state')
            ->orWhereNotIn('payload->review->state', self::REVIEWED_STATES));
    }

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
