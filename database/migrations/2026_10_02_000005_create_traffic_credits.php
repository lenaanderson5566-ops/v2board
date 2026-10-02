<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
use App\Models\User;
use App\Services\TrafficCreditService;

return new class extends Migration {
    public function up(): void
    {
        foreach (['credit_balance', 'credit_migrated_at'] as $column) {
            if (!Schema::hasColumn('v2_user', $column)) Schema::table('v2_user', function (Blueprint $table) use ($column) {
                if ($column === 'credit_balance') $table->unsignedBigInteger($column)->default(0);
                else $table->unsignedInteger($column)->nullable();
            });
        }
        if (!Schema::hasColumn('v2_order', 'credit_bytes')) Schema::table('v2_order', function (Blueprint $table) {
            $table->unsignedBigInteger('credit_bytes')->nullable();
        });
        if (!Schema::hasColumn('v2_order', 'credit_snapshot')) Schema::table('v2_order', function (Blueprint $table) {
            $table->text('credit_snapshot')->nullable();
        });
        if (!Schema::hasTable('v2_traffic_credit_log')) Schema::create('v2_traffic_credit_log', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->integer('user_id')->index();
            $table->string('reference', 80)->unique();
            $table->string('kind', 20);
            $table->unsignedBigInteger('bytes');
            $table->text('snapshot');
            $table->unsignedInteger('created_at');
        });
        // Updater requires queues/scheduler stopped. Per-user transaction permits safe resume.
        User::whereNull('expired_at')->whereNotNull('plan_id')->where('transfer_enable', '>', 0)
            ->whereNull('credit_migrated_at')->select('id')->chunkById(200, function ($users) {
                foreach ($users as $candidate) DB::transaction(function () use ($candidate) {
                    $user = User::where('id', $candidate->id)->lockForUpdate()->first();
                    (new TrafficCreditService())->migrateUser($user);
                    $user->save();
                }, 3);
            });
    }
    public function down(): void
    {
        throw new RuntimeException('Traffic credits contain balances. Restore a coordinated database/code backup; automatic rollback would lose entitlements.');
    }
};
