<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('v2_notice_read')) {
            Schema::create('v2_notice_read', function (Blueprint $table) {
                $table->integer('user_id');
                $table->integer('notice_id');
                $table->unsignedInteger('notice_updated_at');
                $table->unsignedInteger('read_at');
                $table->primary(['user_id', 'notice_id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('v2_notice_read');
    }
};
