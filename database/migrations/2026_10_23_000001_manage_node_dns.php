<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_ddns_credential','root_domain')) Schema::table('v2_ddns_credential', function (Blueprint $t) { $t->string('root_domain',253)->nullable(); });
        if (!Schema::hasColumn('v2_node_ddns','managed')) Schema::table('v2_node_ddns', function (Blueprint $t) {
            $t->string('published_domain',253)->nullable();
            $t->boolean('managed')->default(false);
        });
        if (!Schema::hasTable('v2_node_dns_record')) Schema::create('v2_node_dns_record', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('assignment_id')->index();
            $t->unsignedInteger('credential_id')->index(); $t->string('domain',253);
            $t->string('type',4); $t->string('record_id',32)->nullable();
            $t->string('owner',64)->unique(); $t->string('content',45)->nullable();
            $t->string('status',40)->default('pending');
            $t->bigInteger('delete_after')->default(0)->index();
            $t->bigInteger('next_run')->default(0)->index();
            $t->unique(['credential_id','domain','type'],'node_dns_identity');
        });
    }
    public function down(): void {
        Schema::dropIfExists('v2_node_dns_record');
        Schema::table('v2_node_ddns', function (Blueprint $t) { $t->dropColumn(['published_domain','managed']); });
        Schema::table('v2_ddns_credential', function (Blueprint $t) { $t->dropColumn('root_domain'); });
    }
};
