<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlanTranslation extends Model
{
    protected $table = 'v2_plan_translation';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp'
    ];
}
