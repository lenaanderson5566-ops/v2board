<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Models\ClientStrategy as C;
use App\Models\SubscribeLog;
$n=0;$assert=function($ok,$label)use(&$n){if(!$ok)throw new RuntimeException($label);$n++;};
DB::beginTransaction();
try {
 C::query()->delete();
 DB::table('v2_risk_setting')->where('key','client_access_unified')->delete();
 config(['v2board.subscription_ua_whitelist_enabled'=>1,'v2board.subscription_ua_whitelist'=>['meta','flclash','sing']]);
 foreach([['meta',1,'1.19.0'],['mihomo',0,'1.20.0'],['flclash',1,null],['sing',1,null]] as [$id,$enabled,$minimum]) C::create(['client_type'=>$id,'client_name'=>$id,'is_enabled'=>$enabled,'min_version'=>$minimum]);
 $assert(!(new App\Services\ClientStrategyService())->isEnabled('flclash'),'Unmigrated state fails closed');
 $log=SubscribeLog::create(['user_id'=>1,'client_type'=>' META ','user_agent'=>'mihomo/1.20.0','status'=>'success','created_at'=>time()]);
 $riskId=DB::table('v2_risk_rule_hit')->insertGetId(['scene'=>'subscribe','rule_key'=>'test','client_type'=>'sing','hit_at'=>time()]);
 $total=SubscribeLog::count();
 $migration=require __DIR__.'/../database/migrations/2026_10_12_000001_canonicalize_subscription_clients.php';
 $migration->up();
 $assert(!C::whereIn('client_type',['meta','sing'])->exists(),'Old strategy keys removed');
 $row=C::where('client_type','mihomo')->firstOrFail();
 $assert(!$row->is_enabled && $row->min_version==='1.20.0','Duplicate policies merge conservatively');
 $assert(!C::where('client_type','flclash')->value('is_enabled'),'Old parent restriction preserved');
 $assert(C::where('client_type','sing-box')->value('is_enabled'),'Whitelist alias migrates without losing permitted client');
 $assert(!C::where('client_type','surge')->value('is_enabled'),'Old whitelist exclusion preserved');
 $assert(SubscribeLog::find($log->id)->client_type==='mihomo' && SubscribeLog::count()===$total,'History is normalized without losing records');
 $assert(DB::table('v2_risk_rule_hit')->where('id',$riskId)->value('client_type')==='sing-box','Risk log identity migrated');
 $before=C::orderBy('id')->get()->toJson();$migration->up();
 $assert(C::orderBy('id')->get()->toJson()===$before,'Rerun is idempotent');
 C::where('client_type','mihomo')->update(['min_version'=>'invalid']);
 C::create(['client_type'=>'verge','client_name'=>'old','is_enabled'=>0]);
 try{$migration->up();$assert(false,'Invalid migration accepted');}catch(RuntimeException $e){$assert(str_contains($e->getMessage(),'Invalid minimum version'),'Invalid minimum aborts migration');}
 $assert(C::where('client_type','verge')->exists(),'Failed migration leaves original data intact');
 echo "Canonical migration: {$n} checks passed\n";
} finally {DB::rollBack();}