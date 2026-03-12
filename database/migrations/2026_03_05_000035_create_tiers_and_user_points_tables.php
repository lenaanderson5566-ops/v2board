<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CreateTiersAndUserPointsTables extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_tiers')) {
            Schema::create('v2_tiers', function (Blueprint $table) {
                $table->increments('id');
                $table->string('name', 32)->unique();
                $table->unsignedTinyInteger('level')->unique();
                $table->unsignedInteger('points_required')->default(0);
                $table->integer('created_at')->nullable();
                $table->integer('updated_at')->nullable();
            });
        }

        if (!Schema::hasTable('v2_user_points')) {
            Schema::create('v2_user_points', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('user_id')->unique();
                $table->integer('points')->default(0);
                $table->unsignedInteger('tier_id')->default(1);
                $table->integer('created_at')->nullable();
                $table->integer('updated_at')->nullable();
                $table->index('tier_id');
            });
        }

        if (!Schema::hasTable('v2_user_point_logs')) {
            Schema::create('v2_user_point_logs', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('user_id')->index();
                $table->integer('points')->default(0);
                $table->string('type', 32)->index();
                $table->string('description', 255)->nullable();
                $table->integer('created_at')->nullable();
                $table->integer('updated_at')->nullable();
            });
        }

        $now = time();
        $tiers = [
            ['id' => 1, 'name' => 'member', 'level' => 1, 'points_required' => 0],
            ['id' => 2, 'name' => 'silver', 'level' => 2, 'points_required' => 1000],
            ['id' => 3, 'name' => 'gold', 'level' => 3, 'points_required' => 5000],
            ['id' => 4, 'name' => 'platinum', 'level' => 4, 'points_required' => 20000],
            ['id' => 5, 'name' => 'diamond', 'level' => 5, 'points_required' => 50000],
        ];

        foreach ($tiers as $tier) {
            DB::table('v2_tiers')->updateOrInsert(
                ['id' => $tier['id']],
                [
                    'name' => $tier['name'],
                    'level' => $tier['level'],
                    'points_required' => $tier['points_required'],
                    'updated_at' => $now,
                ]
            );
        }

        $users = DB::table('v2_user')->select('id')->get();

        foreach ($users as $user) {
            $userPoint = DB::table('v2_user_points')->where('user_id', $user->id)->first();
            if (!$userPoint) {
                DB::table('v2_user_points')->insert([
                    'user_id' => $user->id,
                    'points' => 0,
                    'tier_id' => 1,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            $initLogExists = DB::table('v2_user_point_logs')
                ->where('user_id', $user->id)
                ->where('type', 'init')
                ->exists();

            if (!$initLogExists) {
                DB::table('v2_user_point_logs')->insert([
                    'user_id' => $user->id,
                    'points' => 0,
                    'type' => 'init',
                    'description' => 'System initialization',
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down()
    {
        Schema::dropIfExists('v2_user_point_logs');
        Schema::dropIfExists('v2_user_points');
        Schema::dropIfExists('v2_tiers');
    }
}
