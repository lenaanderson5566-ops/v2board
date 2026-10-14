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
echo "PASS full MySQL install SQL and mail feedback schema\n";
