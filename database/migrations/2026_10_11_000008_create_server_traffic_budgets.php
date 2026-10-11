<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void {
  Schema::create('v2_server_traffic_budget',function(Blueprint $t){$t->increments('id');$t->string('name',100);$t->unsignedBigInteger('limit_bytes')->default(0);$t->string('counting_mode',10)->default('both');$t->unsignedTinyInteger('reset_day')->default(1);});
  Schema::create('v2_server_traffic_binding',function(Blueprint $t){$t->increments('id');$t->unsignedInteger('budget_id')->index();$t->string('node_type',10);$t->unsignedInteger('node_id');$t->unique(['node_type','node_id']);});
  Schema::create('v2_server_traffic_day',function(Blueprint $t){$t->bigIncrements('id');$t->unsignedInteger('budget_id');$t->unsignedInteger('day_at');$t->unsignedBigInteger('upload_bytes')->default(0);$t->unsignedBigInteger('download_bytes')->default(0);$t->unique(['budget_id','day_at']);});
 }
 public function down(): void {Schema::dropIfExists('v2_server_traffic_day');Schema::dropIfExists('v2_server_traffic_binding');Schema::dropIfExists('v2_server_traffic_budget');}
};
