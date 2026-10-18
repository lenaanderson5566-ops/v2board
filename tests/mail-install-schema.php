<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function($e) {fwrite(STDERR,get_class($e).': '.$e->getMessage().PHP_EOL);exit(1);});
if (!app()->environment(['local','testing'])) throw new RuntimeException('Local/test only');
$name=getenv('NOTIFICATION_INSTALL_DATABASE');
if (!preg_match('/^notification_install_[a-f0-9]{8}$/D',(string)$name)) throw new RuntimeException('Unsafe database name');
$c=config('database.connections.mysql');$c['database']=$name;
config(['database.connections.mail_install_test'=>$c,'database.default'=>'mail_install_test']);
Illuminate\Support\Facades\DB::purge('mail_install_test');
if (Illuminate\Support\Facades\DB::select('SHOW TABLES')) throw new RuntimeException('Requires empty isolated database');
Illuminate\Support\Facades\DB::unprepared(file_get_contents(__DIR__.'/../database/install.sql'));
foreach(['v2_mail_blocklist'=>['email_encrypted','note','released_at'],'v2_mail_blocklist_audit'=>['action','administrator_id'],'v2_mail_campaign'=>['request_key','purpose','content'],'v2_mail_campaign_recipient'=>['scheduled_at','delivery_status'],'v2_ticket_notification_read'=>['message_id'],'v2_mail_log'=>['stream','delivery_status','transport_code'],'v2_user'=>['announcement_email'],'v2_mail_event'=>['event_key','applied_at'],'v2_mail_suppression'=>['released_at','reason']] as $table=>$columns) {
    if (!Illuminate\Support\Facades\Schema::hasColumns($table,$columns)) throw new RuntimeException('Missing schema: '.$table);
}
// Exercise the installer's real administrator creation against the unmodified install SQL.
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
echo "PASS full MySQL install SQL and mail feedback schema\n";
