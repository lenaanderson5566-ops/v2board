<?php

$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) {
    throw new RuntimeException('Local only');
}
use App\Models\Coupon;
use Illuminate\Support\Facades\DB;
DB::beginTransaction();
try {
    Coupon::query()->delete();
    $service = new App\Services\Actions\User\CommActions();
    $available = fn() => json_decode($service->config()->getContent(), true)['data']['coupons_available'];
    $assert = function ($ok) {
        if (!$ok) {
            throw new RuntimeException('Coupon availability failed');
        }
    };
    $assert(!$available());
    $coupon = Coupon::create(['name' => 'test', 'code' => 'test-coupon', 'show' => 0, 'type' => 1, 'value' => 100, 'started_at' => time() - 60, 'ended_at' => time() + 60, 'limit_use' => null]);
    $assert(!$available());
    $coupon->update(['show' => 1]);
    $assert(!$available()); // Historical amount/code templates cannot enable wallet offers.
    $coupon->update(['type' => 2, 'value' => 10]);
    $assert($available());
    $coupon->update(['limit_use' => 0]);
    $assert(!$available());
    $coupon->update(['limit_use' => 1, 'started_at' => time() + 60]);
    $assert(!$available());
    $coupon->update(['started_at' => time() - 60, 'ended_at' => time() - 1]);
    $assert(!$available());
    $coupon->update(['ended_at' => time() + 60]);
    $encoded = App\Http\Resources\V10\Resource::encode('preferences', json_decode($service->config()->getContent(), true)['data']);
    $assert($encoded['couponsAvailable'] === true);
    echo "Coupon availability: wallet and historical-template checks passed\n";
} finally {
    DB::rollBack();
}
