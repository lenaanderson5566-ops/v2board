<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_lightsail_credential')) Schema::create('v2_lightsail_credential', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 100);
            $table->text('credentials');
        });
        if (!Schema::hasColumn('v2_lightsail_server', 'credential_id')) Schema::table('v2_lightsail_server', function (Blueprint $table) {
            $table->unsignedInteger('credential_id')->nullable()->index();
        });
        if (!Schema::hasColumn('v2_lightsail_server', 'credentials')) return;
        // Ciphertexts differ even for the same key; compare canonical plaintext only in memory.
        $identity = static function (string $encrypted): string {
            try {
                $value = json_decode(Crypt::decryptString($encrypted), true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($value) || empty($value['key']) || empty($value['secret'])) throw new RuntimeException();
                return hash('sha256', json_encode([$value['key'], $value['secret'], $value['token'] ?? null], JSON_THROW_ON_ERROR));
            } catch (Throwable $e) { throw new RuntimeException('Cannot migrate Lightsail credentials; original encrypted data retained.'); }
        };
        DB::transaction(function () use ($identity) {
            $known = [];
            foreach (DB::table('v2_lightsail_credential')->orderBy('id')->get() as $credential) $known[$identity($credential->credentials)] = $credential->id;
            foreach (DB::table('v2_lightsail_server')->orderBy('id')->lockForUpdate()->get() as $server) {
                if ($server->credential_id && DB::table('v2_lightsail_credential')->where('id', $server->credential_id)->exists()) continue;
                $key = $identity($server->credentials);
                $id = $known[$key] ??= DB::table('v2_lightsail_credential')->insertGetId(['name' => mb_substr($server->name.' AWS', 0, 100), 'credentials' => $server->credentials]);
                DB::table('v2_lightsail_server')->where('id', $server->id)->update(['credential_id' => $id]);
            }
        });
        Schema::table('v2_lightsail_server', fn (Blueprint $table) => $table->dropColumn('credentials'));
    }
    public function down(): void {
        throw new RuntimeException('Restore a coordinated backup to roll back shared Lightsail credentials.');
    }
};
