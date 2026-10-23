<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Services\NodeAddressService as Addresses;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
config(['cache.default'=>'array']);
$checks=0;
$assert=function($ok)use(&$checks){if(!$ok)throw new RuntimeException('Address assertion failed');$checks++;};
Addresses::observe(Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR'=>'8.8.8.8']), 'v2box', 987654);
Addresses::observe(Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR'=>'1.1.1.1']), 'v2node', 987654);
Addresses::observe(Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR'=>'127.0.0.1','HTTP_X_FORWARDED_FOR'=>'9.9.9.9']), 'v2box', 987654);
$nodes=[['type'=>'v2box','id'=>987654],['type'=>'v2node','id'=>987654],['type'=>'v2box','id'=>987655,'service_id'=>987654],['type'=>'v2box','id'=>987656]];
$rows=Addresses::forNodes($nodes);
$assert($rows[0]['current_ip']==='8.8.8.8');
$assert($rows[1]['current_ip']==='1.1.1.1');
$assert($rows[2]['current_ip']==='8.8.8.8');
$assert($rows[3]['current_ip']===null);
DB::beginTransaction();
try {
    $id=DB::table('v2_node_ddns')->insertGetId(['credential_id'=>0,'node_type'=>'v2box','node_id'=>987654,'domain'=>'current-ip-test.invalid','family'=>'dual','enabled'=>1,'ipv4'=>'9.9.9.9','ipv4_seen_at'=>time(),'ipv6'=>'2606:4700:4700::1111','ipv6_seen_at'=>time()]);
    $assert(Addresses::forNodes($nodes)[0]['current_ip']==='9.9.9.9 / 2606:4700:4700::1111');
    DB::table('v2_node_ddns')->where('id',$id)->update(['ipv4_seen_at'=>time()-901,'ipv6_seen_at'=>time()-901]);
    $assert(Addresses::forNodes($nodes)[0]['current_ip']==='8.8.8.8');
    DB::table('v2_node_ddns')->where('id',$id)->update(['enabled'=>0,'ipv4_seen_at'=>time()]);
    $assert(Addresses::forNodes($nodes)[0]['current_ip']==='8.8.8.8');
} finally { DB::rollBack(); }
Cache::forget('NODE_CURRENT_IP:v2box:987654');
$assert(Addresses::forNodes($nodes)[0]['current_ip']===null);
echo "Node address: {$checks} checks passed\n";
