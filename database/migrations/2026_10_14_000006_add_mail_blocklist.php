<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_mail_blocklist')) Schema::create('v2_mail_blocklist',function(Blueprint $t){
            $t->string('recipient_hash',64)->primary(); $t->text('email_encrypted'); $t->string('note',1000);
            $t->unsignedInteger('revision')->default(1); $t->unsignedBigInteger('administrator_id');
            $t->unsignedInteger('created_at'); $t->unsignedInteger('updated_at'); $t->unsignedInteger('released_at')->nullable();
            $t->index(['released_at','updated_at'],'mail_blocklist_active');
        });
        if (!Schema::hasTable('v2_mail_blocklist_audit')) Schema::create('v2_mail_blocklist_audit',function(Blueprint $t){
            $t->bigIncrements('id'); $t->string('recipient_hash',64); $t->unsignedBigInteger('administrator_id');
            $t->string('action',16); $t->unsignedInteger('created_at');
            $t->index(['recipient_hash','id'],'mail_blocklist_history');
        });
    }
    public function down(): void { throw new RuntimeException('Preserve manual mail restrictions and audit history.'); }
};
