<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up() {
        if (!Schema::hasTable('v2_registration_signal')) Schema::create('v2_registration_signal', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->unsignedInteger('user_id')->unique();
            $t->string('ip_hash',64)->nullable();
            $t->string('ua_hash',64)->nullable();
            $t->unsignedInteger('created_at')->index();
        });
        if (!Schema::hasTable('v2_invitation_review')) Schema::create('v2_invitation_review', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->unsignedInteger('user_id')->unique();
            $t->unsignedInteger('inviter_id')->index();
            $t->json('signals');
            $t->string('state',24)->default('pending')->index();
            $t->unsignedInteger('revision')->default(0);
            $t->unsignedInteger('created_at')->index();
            $t->unsignedInteger('updated_at');
        });
        if (!Schema::hasTable('v2_invitation_review_event')) Schema::create('v2_invitation_review_event', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('review_id')->index();
            $t->unsignedInteger('admin_id');
            $t->string('state',24);
            $t->string('note',1000);
            $t->unsignedInteger('created_at');
        });
    }
    public function down() {
        Schema::dropIfExists('v2_invitation_review_event');
        Schema::dropIfExists('v2_invitation_review');
        Schema::dropIfExists('v2_registration_signal');
    }
};
