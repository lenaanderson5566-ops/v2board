<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void {Schema::create('v2_server_traffic_import',function(Blueprint $t){$t->increments('id');$t->string('node_type',10);$t->unsignedInteger('node_id');$t->unsignedInteger('budget_id');$t->unique(['node_type','node_id']);});}
 public function down(): void {Schema::dropIfExists('v2_server_traffic_import');}
};
