<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_user','account_deleted_at')) Schema::table('v2_user',function(Blueprint $table) { $table->unsignedBigInteger('account_deleted_at')->nullable(); });
    }
    public function down(): void { /* Identity erasure cannot be reversed. Preserve the tombstone. */ }
};
