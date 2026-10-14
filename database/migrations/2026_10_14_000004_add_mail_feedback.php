<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_user','announcement_email')) Schema::table('v2_user',fn(Blueprint $t)=>$t->boolean('announcement_email')->default(false));
        if (!Schema::hasColumn('v2_mail_log','stream')) Schema::table('v2_mail_log',fn(Blueprint $t)=>$t->string('stream',24)->nullable()->index());
        if (!Schema::hasColumn('v2_mail_log','delivery_status')) Schema::table('v2_mail_log',function(Blueprint $t) { $t->string('delivery_status',24)->nullable()->index(); $t->unsignedInteger('delivery_at')->nullable(); $t->index(['provider','message_id'],'mail_provider_message'); });
        if (!Schema::hasTable('v2_mail_event')) Schema::create('v2_mail_event',function(Blueprint $t) {
            $t->bigIncrements('id'); $t->string('event_key',64)->unique(); $t->string('provider',24); $t->string('message_id',255); $t->string('recipient_hash',64); $t->string('state',24); $t->unsignedInteger('occurred_at'); $t->unsignedInteger('created_at'); $t->unsignedInteger('applied_at')->nullable();
            $t->index(['provider','message_id'],'mail_event_message'); $t->index('created_at');
        });
        if (!Schema::hasTable('v2_mail_suppression')) Schema::create('v2_mail_suppression',function(Blueprint $t) {
            $t->string('recipient_hash',64)->primary(); $t->string('email',64); $t->string('reason',24); $t->unsignedInteger('released_at')->nullable(); $t->unsignedInteger('created_at'); $t->unsignedInteger('updated_at');
        });
    }
    public function down(): void { throw new \RuntimeException('Restore a coordinated backup for mail feedback rollback.'); }
};
