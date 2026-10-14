<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_telegram_identity')) {
            Schema::create('v2_telegram_identity', function (Blueprint $t) {
                $t->bigInteger('telegram_id')->primary();
                $t->unsignedBigInteger('user_id')->unique();
            });
        }
        // Preserve ambiguous historical accounts for manual review; never guess an owner.
        DB::table('v2_user')->selectRaw('telegram_id, MIN(id) AS user_id')
            ->whereNotNull('telegram_id')->where('telegram_id','>',0)->groupBy('telegram_id')->havingRaw('COUNT(*) = 1')
            ->orderBy('telegram_id')->chunk(200, function ($rows) {
                foreach ($rows as $row) DB::table('v2_telegram_identity')->insertOrIgnore((array)$row);
            });
        if (!Schema::hasTable('v2_telegram_update')) Schema::create('v2_telegram_update', function (Blueprint $t) {
            $t->bigIncrements('id'); $t->char('bot_key',64); $t->unsignedBigInteger('update_id');
            $t->mediumText('payload')->nullable(); $t->string('status',16)->default('pending');
            $t->unsignedInteger('attempts')->default(0); $t->unsignedInteger('next_at')->default(0)->index();
            $t->unsignedInteger('created_at'); $t->string('error_code',48)->nullable();
            $t->unique(['bot_key','update_id']);
        });
        if (!Schema::hasTable('v2_telegram_payment_notice')) Schema::create('v2_telegram_payment_notice', function (Blueprint $t) {
            $t->bigIncrements('id'); $t->unsignedBigInteger('order_id'); $t->unsignedBigInteger('user_id');
            $t->bigInteger('telegram_id'); $t->char('bot_key',64);
            $t->string('status',16)->default('pending'); $t->unsignedInteger('next_at')->default(0)->index();
            $t->unsignedInteger('attempts')->default(0); $t->unsignedInteger('created_at');
            $t->string('error_code',48)->nullable(); $t->unique(['order_id','user_id']);
        });
    }
    public function down(): void { throw new RuntimeException('Restore a coordinated backup instead of dropping Telegram delivery records.'); }
};
