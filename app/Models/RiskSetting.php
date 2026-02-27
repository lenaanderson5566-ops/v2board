<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiskSetting extends Model
{
    protected $table = 'v2_risk_setting';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
}
