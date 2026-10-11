<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage()." at ".$e->getFile().":".$e->getLine()."\n"); foreach($e->getTrace() as $frame) fwrite(STDERR,($frame["file"]??"").":".($frame["line"]??0)." ".($frame["function"]??"")."\n");exit(1);});
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
$checks=0;
$assert=function($ok,$label)use(&$checks){if(!$ok)throw new RuntimeException($label);$checks++;};
$migration=require __DIR__.'/../database/migrations/2026_10_11_000002_drop_retired_node_tables.php';
$originalConnection=DB::getDefaultConnection();
$connection=config('database.connections.'.config('database.default'));
$connection['prefix']='test_retired_'.bin2hex(random_bytes(4)).'_';
config(['database.connections.retired_node_test'=>$connection]);
$db=DB::connection('retired_node_test');
$schema=$db->getSchemaBuilder();
$protected=['v2_server_v2node','v2_server_v2box','v2_server_group','v2_server_route','v2_stat_server','v2_order','v2_user'];
$tables=array_merge($migration::TABLES,$protected);
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
}finally{
    DB::setDefaultConnection($originalConnection);
    foreach($tables as $table)$schema->dropIfExists($table);
    DB::purge('retired_node_test');
}
echo "Retired node table migration: $checks checks passed\n";
