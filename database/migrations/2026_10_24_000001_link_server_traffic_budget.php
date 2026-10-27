<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
 public function up(): void {
  if (!Schema::hasColumn('v2_server_traffic_budget','network_server_id')) Schema::table('v2_server_traffic_budget',function(Blueprint $t){$t->unsignedInteger('network_server_id')->nullable()->unique();});
  // Adopt only a one-to-one, explicit physical-server ownership. Never merge usage.
  $owners=DB::table('v2_node_ddns')->whereIn('node_type',['v2box'])->whereNotNull('server_id')->get()->keyBy(fn($a)=>$a->node_type.':'.$a->node_id);
  $candidates=[];
  foreach(DB::table('v2_server_traffic_binding')->get()->groupBy('budget_id') as $bid=>$bindings){
   $servers=[];$complete=true;
   foreach($bindings as $b){$owner=$owners->get($b->node_type.':'.$b->node_id);if(!$owner){$complete=false;break;}$servers[$owner->server_id]=true;}
   if($complete && count($servers)===1)$candidates[array_key_first($servers)][]=$bid;
  }
  foreach($candidates as $server=>$ids)if(count($ids)===1 && !DB::table('v2_server_traffic_budget')->where('network_server_id',$server)->exists())DB::table('v2_server_traffic_budget')->where('id',$ids[0])->whereNull('network_server_id')->update(['network_server_id'=>$server]);
 }
 public function down(): void {throw new RuntimeException('Restore a coordinated backup to remove physical server quota ownership.');}
};
