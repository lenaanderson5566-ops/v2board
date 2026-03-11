<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{

    public const TYPE_NEW = 1;
    public const TYPE_RENEW = 2;
    public const TYPE_UPGRADE = 3;
    public const TYPE_RESET = 4;
    public const TYPE_DOWNGRADE = 5;
    public const TYPE_DEPOSIT = 9;


    public const CHANGE_DIRECTION_UPGRADE = 1;
    public const CHANGE_DIRECTION_DOWNGRADE = 2;
    public const CHANGE_DIRECTION_LATERAL = 3;

    public const CHANGE_APPLY_IMMEDIATE = 1;
    public const CHANGE_APPLY_NEXT_CYCLE = 2;

    public const TYPE_LABELS = [
        self::TYPE_NEW => 'new',
        self::TYPE_RENEW => 'renew',
        self::TYPE_UPGRADE => 'upgrade',
        self::TYPE_RESET => 'reset',
        self::TYPE_DOWNGRADE => 'downgrade',
        self::TYPE_DEPOSIT => 'deposit',
    ];

    public static function isValidType(int $type): bool
    {
        return isset(self::TYPE_LABELS[$type]);
    }


    public static function typeText(?int $type): string
    {
        switch ((int) $type) {
            case self::TYPE_NEW:
                return __('Order Type New');
            case self::TYPE_RENEW:
                return __('Order Type Renew');
            case self::TYPE_UPGRADE:
                return __('Order Type Upgrade');
            case self::TYPE_RESET:
                return __('Order Type Reset');
            case self::TYPE_DOWNGRADE:
                return __('Order Type Downgrade');
            case self::TYPE_DEPOSIT:
                return __('Order Type Deposit');
            default:
                return __('Order Type Unknown');
        }
    }

    public static function changeApplyModeText(?int $mode): string
    {
        switch ((int) $mode) {
            case self::CHANGE_APPLY_IMMEDIATE:
                return __('Change Apply Immediate');
            case self::CHANGE_APPLY_NEXT_CYCLE:
                return __('Change Apply Next Cycle');
            default:
                return __('Change Apply Unknown');
        }
    }

    protected $table = 'v2_order';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'surplus_order_ids' => 'array',
        'exchange_rate' => 'float',
        'change_direction' => 'integer',
        'change_apply_mode' => 'integer',
        'change_effective_at' => 'timestamp',
        'change_applied_at' => 'timestamp'
    ];
}
