<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function($e) {fwrite(STDERR,get_class($e).': '.$e->getMessage().PHP_EOL);exit(1);});
if (getenv('TEST_DISPOSABLE_WORKSPACE') !== '1') throw new RuntimeException('Disposable project required');
if (!app()->environment(['local','testing'])) throw new RuntimeException('Local/test only');
$name=getenv('NOTIFICATION_INSTALL_DATABASE');
if (!preg_match('/^notification_install_[a-f0-9]{8}$/D',(string)$name)) throw new RuntimeException('Unsafe database name');
$c=config('database.connections.mysql');$c['database']=$name;
config(['database.connections.mail_install_test'=>$c,'database.default'=>'mail_install_test']);
Illuminate\Support\Facades\DB::purge('mail_install_test');
if (Illuminate\Support\Facades\DB::select('SHOW TABLES')) throw new RuntimeException('Requires empty isolated database');
$installer=new App\Console\Commands\V2boardInstall;
$installer->setLaravel($app);
$import=new ReflectionMethod($installer,'importDatabase');
foreach (['', 'INVALID SQL containing_private_fixture'] as $sql) {
    try { $import->invoke($installer,$sql); throw new LogicException('Invalid installation SQL accepted'); }
    catch (RuntimeException $expected) {
        if (str_contains($expected->getMessage(),'containing_private_fixture')) throw new LogicException('Raw SQL leaked');
    }
}
// Run the real interactive installer in this disposable project, using the empty test DB.
$environment=app()->environmentFilePath();
$backup=$environment.'.install-fixture-'.bin2hex(random_bytes(6));
$cached=app()->getCachedConfigPath();
$cacheBefore=is_file($cached) ? file_get_contents($cached) : null;
rename($environment,$backup);
try {
    $tester=new Symfony\Component\Console\Tester\CommandTester($installer);
    $tester->setInputs([$c['host'],$name,$c['username'],$c['password'],'installer-command@example.test']);
    $status=$tester->execute([]);
    if ($status!==0 || !str_contains($tester->getDisplay(),'数据库导入完成')) throw new LogicException('Interactive install failed');
    if (!App\Models\User::where('email','installer-command@example.test')->where('is_admin',1)->exists()) throw new LogicException('Interactive administrator missing');
} finally {
    if (is_file($environment)) unlink($environment);
    rename($backup,$environment);
    if ($cacheBefore===null) { if (is_file($cached)) unlink($cached); }
    else file_put_contents($cached,$cacheBefore);
}

try { $import->invoke($installer,'DROP TABLE v2_user'); throw new LogicException('Nonempty install accepted'); }
catch (RuntimeException $expected) {}
// Existing sites must fail without deleting or changing their environment.
$environment=app()->environmentFilePath(); $before=hash_file('sha256',$environment);
$output=new Symfony\Component\Console\Output\BufferedOutput;
$status=$installer->run(new Symfony\Component\Console\Input\ArrayInput([]),$output);
if ($status!==1 || hash_file('sha256',$environment)!==$before) throw new LogicException('Existing install was not refused safely');
// Exercise repeated writes and dotenv metacharacters in a private, disposable fixture.
$writer=new ReflectionMethod($installer,'saveToEnv');
$directory=storage_path('app/install-env-'.bin2hex(random_bytes(6)));
mkdir($directory,0700,true); file_put_contents($directory.'/.env',"KEEP=unchanged\nDB_PASSWORD=old\n");
// config:cache may rebind the application container; the writer uses app().
$originalPath=app()->environmentPath();
try {
    app()->useEnvironmentPath($directory);
    foreach (['space #hash', 'quote" dollar${NAME} slash\\ tail', "line\nnext\rline", ''] as $password) {
        $writer->invoke($installer,['DB_PASSWORD'=>$password,'NEW_KEY'=>'added']);
        $parsed=Dotenv\Dotenv::parse(file_get_contents($directory.'/.env'));
        if ($parsed['DB_PASSWORD']!==$password || $parsed['KEEP']!=='unchanged' || $parsed['NEW_KEY']!=='added') throw new LogicException('Environment roundtrip failed');
    }
} finally {
    app()->useEnvironmentPath($originalPath);
    unlink($directory.'/.env'); rmdir($directory);
}

foreach(['v2_mail_blocklist'=>['email_encrypted','note','released_at'],'v2_mail_blocklist_audit'=>['action','administrator_id'],'v2_mail_campaign'=>['request_key','purpose','content'],'v2_mail_campaign_recipient'=>['scheduled_at','delivery_status'],'v2_ticket_notification_read'=>['message_id'],'v2_mail_log'=>['stream','delivery_status','transport_code'],'v2_user'=>['announcement_email'],'v2_mail_event'=>['event_key','applied_at'],'v2_mail_suppression'=>['released_at','reason']] as $table=>$columns) {
    if (!Illuminate\Support\Facades\Schema::hasColumns($table,$columns)) throw new RuntimeException('Missing schema: '.$table);
}
// Exercise the installer's real administrator creation against the unmodified install SQL.
$nodeMigration=require __DIR__.'/../database/migrations/2026_10_20_000003_create_node_credentials.php';
$nodeMigration->up(); $nodeMigration->up();
foreach(['v2_node_credential'=>['secret_hash','revoked_at','last_used_at'],'v2_node_credential_state'=>['node_type','node_id','migrated_at']] as $table=>$columns) {
    if (!Illuminate\Support\Facades\Schema::hasColumns($table,$columns)) throw new RuntimeException('Missing node credential schema: '.$table);
}
if (Illuminate\Support\Facades\Schema::hasColumn('v2_user','is_staff')) throw new RuntimeException('Fresh install recreated retired staff role');
$registerAdmin=new ReflectionMethod(App\Console\Commands\V2boardInstall::class,'registerAdmin');
$registerAdmin->setAccessible(true);
$password='Install-fixture-123';
if (!$registerAdmin->invoke(new App\Console\Commands\V2boardInstall,'fresh-admin@example.test',$password)) throw new RuntimeException('Fresh administrator creation failed');
$admin=App\Models\User::where('email','fresh-admin@example.test')->firstOrFail();
if ((int)$admin->is_admin!==1 || !password_verify($password,$admin->password) || !$admin->token || !$admin->uuid) throw new RuntimeException('Fresh administrator credentials or permissions invalid');
$auth=new App\Services\AuthService($admin);
try {
    $token=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $migration=require __DIR__.'/../database/migrations/2026_10_18_000001_drop_retired_staff_role.php';
    $migration->up(); $migration->up();
    $claims=App\Services\AuthService::decryptAuthData($token);
    if (!$claims || (int)$claims['is_admin']!==1 || array_key_exists('is_staff',$claims)) throw new RuntimeException('Fresh install authentication depends on retired role');
    if (!password_verify($password,$admin->fresh()->password)) throw new RuntimeException('Fresh migration changed administrator password');
} finally { $auth->removeAllSession(); }
echo "PASS fresh installation administrator creation, credentials, authentication and repeated staff cleanup\n";
echo "PASS full MySQL install SQL, failure/nonempty guards, environment escaping and mail feedback schema\n";
