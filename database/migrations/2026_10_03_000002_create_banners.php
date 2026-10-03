<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_banner')) return;
        Schema::create('v2_banner', function (Blueprint $table) {
            $table->increments('id');
            $table->string('title', 200);
            $table->string('image_url', 2048);
            $table->string('mobile_image_url', 2048)->nullable();
            $table->string('target_url', 2048)->nullable();
            $table->json('placements');
            $table->json('languages')->nullable();
            $table->boolean('show')->default(true);
            $table->integer('sort')->default(0);
            $table->unsignedInteger('starts_at')->nullable();
            $table->unsignedInteger('ends_at')->nullable();
            $table->unsignedInteger('created_at');
            $table->unsignedInteger('updated_at');
            $table->index(['show', 'sort']);
        });
        DB::table('v2_banner')->insert([
            'title'=>'Fastdog 3.0 — Faster. Simpler. Smarter.',
            'image_url'=>'/banners/fastdog-3-launch-slim.png',
            'mobile_image_url'=>'/banners/fastdog-3-launch.png',
            'placements'=>json_encode(['dashboard']), 'languages'=>json_encode([]),
            'show'=>true, 'sort'=>0, 'created_at'=>time(), 'updated_at'=>time(),
        ]);
    }
    public function down(): void { Schema::dropIfExists('v2_banner'); }
};
