<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

class CurrencySetting extends Model
{
    protected $table = 'v2_currency_setting';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];

    public static function getValue(string $key, ?string $default = null): ?string
    {
        if (!Schema::hasTable('v2_currency_setting')) return $default;
        $row = self::query()->where('key', $key)->first();
        return $row ? $row->value : $default;
    }

    public static function setValue(string $key, string $value): void
    {
        if (!Schema::hasTable('v2_currency_setting')) return;
        self::query()->updateOrCreate(['key' => $key], ['value' => $value]);
    }
}
