<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
class CreateNodeDdns extends Migration {
    public function up() {
        if (!Schema::hasTable('v2_ddns_credential')) Schema::create('v2_ddns_credential', function (Blueprint $t) {
            $t->increments('id'); $t->string('name',100); $t->string('zone_id',32); $t->text('secret');
            $t->bigInteger('next_run')->default(0); $t->string('status',40)->default('ready');
        });
        if (!Schema::hasTable('v2_node_ddns')) Schema::create('v2_node_ddns', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('credential_id')->index();
            $t->string('node_type',10); $t->unsignedInteger('node_id'); $t->unique(['node_type','node_id']);
            $t->string('domain',253)->unique(); $t->string('family',8); $t->boolean('enabled')->default(true);
            $t->string('report_hash',64)->nullable()->unique();
            foreach (['ipv4','ipv6'] as $family) { $t->string($family,45)->nullable(); $t->bigInteger($family.'_seen_at')->default(0); }
            $t->bigInteger('next_run')->default(0)->index(); $t->bigInteger('last_success')->default(0);
            $t->string('status',40)->default('awaiting_report');
        });
        if (!Schema::hasTable('v2_ddns_event')) Schema::create('v2_ddns_event', function (Blueprint $t) {
            $t->bigIncrements('id'); $t->unsignedInteger('assignment_id')->index();
            $t->string('code',40); $t->unsignedSmallInteger('http_status')->nullable(); $t->bigInteger('created_at')->index();
        });
    }
    public function down() { Schema::dropIfExists('v2_ddns_event'); Schema::dropIfExists('v2_node_ddns'); Schema::dropIfExists('v2_ddns_credential'); }
}
