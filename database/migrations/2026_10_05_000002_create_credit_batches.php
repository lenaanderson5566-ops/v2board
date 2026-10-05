<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_credit_batch')) Schema::create('v2_credit_batch', function (Blueprint $t) {
            $t->bigIncrements('id'); $t->integer('user_id')->index();
            $t->string('reference', 100)->unique(); $t->unsignedBigInteger('remaining_bytes');
            $t->unsignedInteger('expires_at')->index(); $t->unsignedInteger('created_at');
        });
        if (!Schema::hasColumn('v2_invitation_reward','validity_months')) Schema::table('v2_invitation_reward', function (Blueprint $t) {
            $t->unsignedInteger('validity_months')->default(1);
        });
        // Upgrade grace period: existing balances retain twelve full calendar months.
        $now=time(); $expires=\Carbon\Carbon::createFromTimestampUTC($now)->addMonthsNoOverflow(12)->timestamp;
        DB::table('v2_user')->where('credit_balance','>',0)->orderBy('id')->chunkById(500,function($users) use ($now,$expires) {
            foreach($users as $u) DB::table('v2_credit_batch')->insertOrIgnore([
                'user_id'=>$u->id,'reference'=>'upgrade:'.$u->id,'remaining_bytes'=>$u->credit_balance,'expires_at'=>$expires,'created_at'=>$now,
            ]);
        });
    }
    public function down(): void { throw new RuntimeException('Credit expiry requires coordinated backup restore.'); }
};
