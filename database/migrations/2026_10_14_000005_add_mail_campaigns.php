<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_mail_campaign')) Schema::create('v2_mail_campaign',function(Blueprint $t){
            $t->bigIncrements('id'); $t->uuid('request_key')->unique(); $t->unsignedBigInteger('administrator_id'); $t->string('purpose',16);
            $t->string('subject',200); $t->longText('content'); $t->longText('translations'); $t->string('source_language',16)->nullable();
            $t->unsignedInteger('created_at'); $t->unsignedInteger('expires_at');
        });
        if (!Schema::hasTable('v2_mail_campaign_recipient')) Schema::create('v2_mail_campaign_recipient',function(Blueprint $t){
            $t->bigIncrements('id'); $t->unsignedBigInteger('campaign_id'); $t->unsignedBigInteger('user_id');
            $t->string('recipient_hash',64); $t->string('status',16)->default('queued'); $t->string('reason',40)->nullable();
            $t->unsignedBigInteger('mail_log_id')->nullable()->index(); $t->string('delivery_status',24)->nullable(); $t->unsignedInteger('scheduled_at')->default(0); $t->unsignedInteger('attempts')->default(0);
            $t->unsignedInteger('available_at'); $t->unsignedInteger('updated_at');
            $t->unique(['campaign_id','user_id'],'mail_campaign_user'); $t->index(['status','available_at'],'mail_campaign_pending');
        });
        if (!Schema::hasTable('v2_ticket_notification_read')) Schema::create('v2_ticket_notification_read',function(Blueprint $t){
            $t->unsignedBigInteger('ticket_id')->primary(); $t->unsignedBigInteger('user_id'); $t->unsignedBigInteger('message_id');
            $t->unsignedInteger('read_at');
        });
    }
    public function down(): void { throw new RuntimeException('Preserve campaign history and read receipts.'); }
};
