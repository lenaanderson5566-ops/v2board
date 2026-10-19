<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_analytics_session')) return;
        foreach (['browser','os','embedded'] as $column) {
            if (!Schema::hasColumn('v2_analytics_session',$column)) Schema::table('v2_analytics_session',fn(Blueprint $table)=>$table->string($column,16)->nullable());
        }
        if (!Schema::hasColumn('v2_analytics_session','browser_major')) Schema::table('v2_analytics_session',fn(Blueprint $table)=>$table->unsignedSmallInteger('browser_major')->nullable());
    }
    public function down(): void {
        foreach (['browser','os','embedded','browser_major'] as $column) {
            if (Schema::hasColumn('v2_analytics_session',$column)) Schema::table('v2_analytics_session',fn(Blueprint $table)=>$table->dropColumn($column));
        }
    }
};
