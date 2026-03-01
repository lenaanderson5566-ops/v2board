<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CurrencySetting extends Model
{
    protected $table = 'v2_currency_setting';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];

    public static function getValue(string $key, ?string $default = null): ?string
    {
        $row = self::query()->where('key', $key)->first();
        return $row ? $row->value : $default;
    }

    public static function setValue(string $key, string $value): void
    {
        self::query()->updateOrCreate(['key' => $key], ['value' => $value]);
    }
}
