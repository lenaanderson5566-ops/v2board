<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage()." at ".$e->getFile().":".$e->getLine()."\n"); foreach($e->getTrace() as $frame) fwrite(STDERR,($frame["file"]??"").":".($frame["line"]??0)." ".($frame["function"]??"")."\n");exit(1);});
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
$migration=require __DIR__.'/../database/migrations/2026_10_11_000002_drop_retired_node_tables.php';
$originalConnection=DB::getDefaultConnection();
$connection=config('database.connections.'.config('database.default'));
$connection['prefix']='test_retired_'.bin2hex(random_bytes(4)).'_';
config(['database.connections.retired_node_test'=>$connection]);
$db=DB::connection('retired_node_test');
$schema=$db->getSchemaBuilder();
$protected=['v2_server_v2node','v2_server_v2box','v2_server_group','v2_server_route','v2_stat_server','v2_order','v2_user'];
$tables=array_merge($migration::TABLES,$protected);
$authServices=[];
try {
    foreach($tables as $table){
        $schema->create($table,function(Blueprint $table){$table->integer('id');});
        $db->table($table)->insert(['id'=>42]);
    }
    DB::setDefaultConnection('retired_node_test');
    $migration->up();
    $migration->up();
    $assert(Illuminate\Support\Facades\Artisan::call('v2board:update')===1,'Legacy SQL replay command disabled');
    foreach($migration::TABLES as $table)$assert(!$schema->hasTable($table),'Retired table removed: '.$table);
    foreach($protected as $table)$assert((int)$db->table($table)->value('id')===42,'Protected table unchanged: '.$table);
    try{$migration->down();throw new RuntimeException('Rollback claims to restore deleted data');}
    catch(LogicException $e){$checks++;}
    $sql=file_get_contents(__DIR__.'/../database/install.sql');
    foreach($migration::TABLES as $table)$assert(!str_contains($sql,'`'.$table.'`'),'Fresh install excludes '.$table);
    $assert(str_contains($sql,'CREATE TABLE `v2_server_v2node`') && str_contains($sql,'CREATE TABLE IF NOT EXISTS `v2_server_v2box`'),'Fresh install retains both backends');
    $metadata=require __DIR__.'/../database/migrations/2026_10_06_000001_add_node_display_metadata.php';
    $metadata->up();
    $assert($schema->hasColumn('v2_server_v2node','region_code'),'Metadata migration tolerates deleted tables');
    // Upgrade an existing account table without affecting identity or credentials.
    $schema->table('v2_user',function(Blueprint $table){
        $table->string('email')->nullable(); $table->string('password')->nullable();
        $table->string('token')->nullable(); $table->string('uuid')->nullable();
        $table->integer('is_admin')->default(0); $table->integer('is_staff')->default(0);
        $table->integer('banned')->default(0); $table->unsignedBigInteger('account_deleted_at')->nullable();
    });
    $tables[]='v2_user_mfa';
    $schema->create('v2_user_mfa',function(Blueprint $table){$table->integer('user_id');$table->integer('version')->default(0);});
    $db->table('v2_user')->where('id',42)->update(['email'=>'retired-role@example.test','password'=>'fixture-hash','token'=>'fixture-token','uuid'=>'fixture-uuid','is_admin'=>1,'is_staff'=>1]);
    $db->table('v2_user')->insert(['id'=>43,'email'=>'former-staff@example.test','is_admin'=>0,'is_staff'=>1]);
    $before=(array)$db->table('v2_user')->where('id',42)->first();unset($before['is_staff']);
    $tokens=[];
    foreach ([42,43] as $userId) {
        $authServices[$userId]=new App\Services\AuthService(App\Models\User::findOrFail($userId));
        $tokens[$userId]=$authServices[$userId]->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
        $claims=App\Services\AuthService::decryptAuthData($tokens[$userId]);
        $assert($claims && !array_key_exists('is_staff',$claims),'New authentication works against legacy schema without exposing role');
    }
    $roleMigration=require __DIR__.'/../database/migrations/2026_10_18_000001_drop_retired_staff_role.php';
    $roleMigration->up(); $roleMigration->up();
    $assert(!$schema->hasColumn('v2_user','is_staff'),'Retired role column removed and repeat upgrade is safe');
    $assert($before===(array)$db->table('v2_user')->where('id',42)->first(),'Role removal preserves users, administrators and credentials');
    $assert($db->table('v2_user')->count()===2 && (int)$db->table('v2_user')->where('id',43)->value('is_admin')===0,'Former staff account survives without administrator escalation');
    $assert(!str_contains($sql,'`is_staff`'),'Fresh installation excludes retired role');
    foreach ($tokens as $userId=>$token) {
        $claims=App\Services\AuthService::decryptAuthData($token);
        $reference=App\Services\AuthService::sessionReference($token);
        $sessionUser=App\Services\AuthService::sessionUser($reference);
        $assert($claims && (int)$claims['id']===$userId && (int)$claims['is_admin']===($userId===42 ? 1 : 0),'Existing session survives role deletion without escalation');
        $assert($sessionUser && (int)$sessionUser->id===$userId && !array_key_exists('is_staff',$sessionUser->getAttributes()),'Browser session hydration survives deleted role');
    }
    try {$roleMigration->down();throw new RuntimeException('Retired role rollback silently accepted');}
    catch (RuntimeException $error) {$assert(str_contains($error->getMessage(),'cannot be recovered'),'Rollback must not pretend to recover historical role flags');}
    $schema->drop('v2_user');
    $roleMigration->up();
    $assert(!$schema->hasTable('v2_user'),'Cleanup before account-table installation is a no-op');
}finally{
    foreach($authServices as $authService)$authService->removeAllSession();
    DB::setDefaultConnection($originalConnection);
    foreach($tables as $table)$schema->dropIfExists($table);
    DB::purge('retired_node_test');
}
echo "Retired node table migration: $checks checks passed\n";
