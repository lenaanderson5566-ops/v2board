<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('v2_coupon_campaign')) Schema::create('v2_coupon_campaign', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->uuid('preview_key')->unique();
            $t->unsignedBigInteger('administrator_id');
            $t->unsignedInteger('coupon_id');
            $t->text('terms');
            $t->string('template_hash', 64);
            $t->string('scope', 16);
            $t->string('status', 16)->default('draft');
            $t->unsignedInteger('matched_count');
            $t->unsignedInteger('reserved_remaining')->default(0);
            $t->boolean('limited_stock')->default(false);
            $t->unsignedInteger('created_at');
            $t->unsignedInteger('expires_at');
            $t->unsignedInteger('confirmed_at')->nullable();
            $t->unsignedInteger('finished_at')->nullable();
            $t->index(['status','expires_at'], 'coupon_campaign_state');
        });
        if (!Schema::hasTable('v2_coupon_campaign_recipient')) Schema::create('v2_coupon_campaign_recipient', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('campaign_id');
            $t->unsignedInteger('user_id');
            $t->string('status', 16);
            $t->string('reason', 32)->nullable();
            $t->unsignedBigInteger('wallet_id')->nullable();
            $t->unsignedInteger('attempts')->default(0);
            $t->unsignedInteger('available_at');
            $t->unsignedInteger('updated_at');
            $t->unique(['campaign_id','user_id'], 'coupon_campaign_user');
            $t->index(['status','available_at'], 'coupon_campaign_pending');
        });
    }
    public function down(): void { throw new RuntimeException('Preserve coupon issuance audit history.'); }
};
