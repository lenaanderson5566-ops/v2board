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
$protected=['v2_server_v2box','v2_server_group','v2_server_route','v2_stat_server','v2_order','v2_user'];
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
    $assert(!str_contains($sql,'`v2_server_v2node`') && str_contains($sql,'CREATE TABLE `v2_server_v2box`'),'Fresh install contains only V2Box');
    $metadata=require __DIR__.'/../database/migrations/2026_10_06_000001_add_node_display_metadata.php';
    $metadata->up();
    $assert($schema->hasColumn('v2_server_v2box','region_code'),'Metadata migration tolerates deleted tables');
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
    // Service associations retain subscription IDs and reject ambiguous hierarchies before DDL.
    foreach(['v2_server_v2box'] as $table) {
        $schema->table($table,function(Blueprint $t){
            $t->integer('parent_id')->nullable(); $t->string('protocol')->default('anytls');
            $t->integer('tls')->default(1); $t->string('network')->default('tcp');
            $t->text('group_id')->nullable(); $t->string('host')->default('stable.example.test');
            $t->text('tls_settings')->nullable();
            $t->integer('sort')->default(7); $t->string('name')->default('Existing subscription');
        });
        $db->table($table)->where('id',42)->update(['group_id'=>'[1,2]','tls_settings'=>'{"server_name":"tls.example.test","dns_env":{"key":"fixture-secret"}}']);
        $db->table($table)->insert(['id'=>43,'parent_id'=>42,'group_id'=>'[1]','tls_settings'=>'{"server_name":"tls.example.test"}']);
    }
    $db->table('v2_server_v2box')->insert(['id'=>44,'parent_id'=>43,'group_id'=>'[1]']);
    require_once __DIR__.'/../database/migrations/2026_10_23_000004_proxy_service_routes.php';
    $topologyMigration=new ProxyServiceRoutes();
    try {$topologyMigration->up();throw new LogicException('Nested services accepted');}
    catch(RuntimeException $e) {$assert(str_contains($e->getMessage(),'#44'),'Invalid association identifies the affected record');}
    $assert($schema->hasColumn('v2_server_v2box','parent_id') && !$schema->hasColumn('v2_server_v2box','service_id'),'Preflight checks both backends before changing either schema');
    $db->table('v2_server_v2box')->where('id',44)->delete();
    $db->table('v2_server_v2box')->where('id',43)->update(['tls_settings'=>'{"server_name":"different.example.test"}']);
    try {$topologyMigration->up();throw new LogicException('Different TLS identity silently replaced');}
    catch(RuntimeException $e) {$assert(str_contains($e->getMessage(),'TLS identity') && !str_contains($e->getMessage(),'fixture-secret'),'Mismatched legacy TLS identities stop migration without disclosing credentials');}
    $db->table('v2_server_v2box')->where('id',43)->update(['tls_settings'=>'{"server_name":"tls.example.test"}']);
    $tables[]='v2_node_connection';
    $topologyMigration->up();$topologyMigration->up();
    foreach(['v2_server_v2box'] as $table) {
        $line=$db->table($table)->where('id',43)->first();
        $assert(!$schema->hasColumn($table,'parent_id') && $schema->hasColumn($table,'service_id'),'Legacy hierarchy column retired');
        $assert($schema->hasColumn($table,'region_code') && $schema->hasColumn($table,'city_code') && $schema->hasColumn($table,'display_label'),'Both service backends have complete display metadata');
        $assert($line->service_id===42 && $line->host==='stable.example.test' && $line->sort===7 && $line->group_id==='[1]' && $line->name==='Existing subscription','Migration preserves ID, endpoint, order, permissions and name');
        $assert($line->tls_settings===null && str_contains($db->table($table)->where('id',42)->value('tls_settings'),'fixture-secret'),'Certificate configuration is retained only by the proxy service');
    }
    $assert($schema->hasColumn('v2_node_connection','published') && $schema->hasColumn('v2_node_connection','draft'),'Draft and published connection state stored independently');
    $assert(!str_contains($sql,'`parent_id`') && str_contains($sql,'`service_id`'),'Fresh installation uses service association only');
    $retire=require __DIR__.'/../database/migrations/2026_10_27_000001_retire_v2node.php';
    $schema->create('v2_server_v2node',fn(Blueprint $t)=>$t->integer('id'));
    $tables[]='v2_server_v2node';
    $db->table('v2_server_v2node')->insert(['id'=>42]);
    foreach ($retire::REFERENCES as $table=>$column) {
        $schema->dropIfExists($table);
        $schema->create($table, function(Blueprint $t)use($column){$t->integer('id');$t->string($column,16)->default('v2node');});
        $tables[]=$table;
        $db->table($table)->insert([['id'=>10,$column=>'v2node'],['id'=>11,$column=>'v2box']]);
    }
    $retire->up();$retire->up();
    $assert(!$schema->hasTable('v2_server_v2node'),'Retired node table removed idempotently');
    foreach ($retire::REFERENCES as $table=>$column) {
        $assert(!$db->table($table)->where($column,'v2node')->exists() && $db->table($table)->where($column,'v2box')->count()===1,'Only retired configuration removed from '.$table);
    }
    $assert((int)$db->table('v2_server_v2box')->where('id',42)->value('id')===42,'V2Box identity survives retirement');
    $assert((int)$db->table('v2_stat_server')->value('id')===42,'Shared accounting history survives retirement');
    $db->table('v2_server_route')->insert(['id'=>12]);
    $assert($db->table('v2_server_route')->where('id',12)->value('backend')==='v2box','Upgrade defaults routes to V2Box');
    try{$retire->down();throw new RuntimeException('Retirement rollback would fabricate lost records');}
    catch(LogicException $e){$checks++;}
    // Legacy per-server encrypted keys become shared references without changing IP jobs.
    $schema->drop('v2_lightsail_server');
    $schema->create('v2_lightsail_server',function(Blueprint $t){$t->increments('id');$t->string('name');$t->text('credentials');$t->string('status');$t->string('phase');});
    $tables[]='v2_lightsail_credential';
    $secret=static fn($key)=>Illuminate\Support\Facades\Crypt::encryptString(json_encode(['key'=>$key,'secret'=>'fixture-secret','token'=>'fixture-token']));
    $db->table('v2_lightsail_server')->insert([
        ['name'=>'one','credentials'=>$secret('same'),'status'=>'failed','phase'=>'allocate'],
        ['name'=>'two','credentials'=>$secret('same'),'status'=>'running','phase'=>'attach'],
        ['name'=>'other','credentials'=>$secret('different'),'status'=>'ready','phase'=>'idle'],
    ]);
    $shared=require __DIR__.'/../database/migrations/2026_10_27_000002_share_lightsail_credentials.php';
    $invalid=$db->table('v2_lightsail_server')->insertGetId(['name'=>'invalid','credentials'=>'broken-ciphertext','status'=>'ready','phase'=>'idle']);
    try {$shared->up();throw new LogicException('Broken credentials were silently discarded');}
    catch(RuntimeException $e){$assert(str_contains($e->getMessage(),'original encrypted data retained') && $schema->hasColumn('v2_lightsail_server','credentials') && $db->table('v2_lightsail_credential')->count()===0,'Invalid old ciphertext aborts migration without losing source data or partially migrating references');}
    $db->table('v2_lightsail_server')->where('id',$invalid)->delete();
    $shared->up();$shared->up();
    $rows=$db->table('v2_lightsail_server')->orderBy('id')->get();
    $assert($db->table('v2_lightsail_credential')->count()===2 && $rows[0]->credential_id===$rows[1]->credential_id && $rows[2]->credential_id!==$rows[0]->credential_id,'Migration deduplicates equal keys despite randomized ciphertexts and can be retried');
    $assert($rows[0]->status==='failed' && $rows[0]->phase==='allocate' && $rows[1]->status==='running' && $rows[1]->phase==='attach','Credential migration preserves server identity and unfinished operations');
    $assert(!$schema->hasColumn('v2_lightsail_server','credentials') && str_contains(Illuminate\Support\Facades\Crypt::decryptString($db->table('v2_lightsail_credential')->value('credentials')),'fixture-token'),'Encrypted credentials and temporary tokens retained only in shared credential table');
}finally{
    foreach($authServices as $authService)$authService->removeAllSession();
    DB::setDefaultConnection($originalConnection);
    foreach($tables as $table)$schema->dropIfExists($table);
    DB::purge('retired_node_test');
}
echo "Retired node table migration: $checks checks passed\n";
