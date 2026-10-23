<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_node_ddns','tls_transition')) Schema::table('v2_node_ddns',function(Blueprint $t){
            $t->longText('tls_transition')->nullable();
            $t->string('tls_transition_state',16)->default('none');
        });
    }
    public function down(): void { Schema::table('v2_node_ddns',fn(Blueprint $t)=>$t->dropColumn(['tls_transition','tls_transition_state'])); }
};
