<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use App\Services\ClientIdentity;

return new class extends Migration {
    // Frozen migration vocabulary: future registry changes must not alter this data migration.
    private const ALIASES = ['meta'=>'mihomo','clash'=>'mihomo','clash-meta'=>'mihomo','sing'=>'sing-box','verge'=>'clash-verge','nyanpasu'=>'clash-nyanpasu','clashforandroid'=>'clash-for-android','clashforwindows'=>'clash-for-windows','quantumult%20x'=>'quantumult-x','quantumult x'=>'quantumult-x','ssrplus'=>'ssr-plus','mihomo-party'=>'clash-party'];
    private const CLIENTS = ['mihomo','sing-box','clash-verge','flclash','clash-nyanpasu','clash-for-android','clash-for-windows','clashx','quantumult-x','shadowrocket','surge','stash','loon','surfboard','sagernet','passwall','ssr-plus','shadowsocks','v2rayn','v2rayng','v2raytun','clash-party','throne','nekobox','husi'];
    private const MIHOMO = ['mihomo','clash-verge','flclash','clash-nyanpasu','clash-for-android','clash-for-windows','clashx','clash-party','nekobox'];
    private function canonical(string $id): string { $id=strtolower(trim($id)); return self::ALIASES[$id] ?? $id; }
    public function up(): void {
        DB::transaction(function () {
            $rows = DB::table('v2_client_strategy')->orderBy('id')->lockForUpdate()->get();
            $groups = $rows->groupBy(fn ($row) => $this->canonical($row->client_type));
            $unified = DB::table('v2_risk_setting')->where('key','client_access_unified')->exists();
            $whitelist = array_map(fn ($id) => $this->canonical((string)$id), (array)config('v2board.subscription_ua_whitelist', []));
            $policies = [];
            foreach (self::CLIENTS as $id) {
                $group = $groups->get($id, collect());
                $enabled = $group->isEmpty() ? (!$unified && !in_array($id,['clash-party','throne','nekobox','husi'],true)) : $group->every(fn ($row)=>(bool)$row->is_enabled);
                if (!$unified && config('v2board.subscription_ua_whitelist_enabled',0) && !in_array($id,$whitelist,true)) $enabled=false;
                $minimum = null;
                foreach ($group as $row) {
                    if (trim((string)$row->min_version)==='') continue;
                    $version = ClientIdentity::normalizeVersion($row->min_version);
                    if ($version === null) throw new RuntimeException('Invalid minimum version for client '.$id.'; correct it before migration.');
                    if ($minimum === null || ClientIdentity::allowsVersion($minimum,$version)) $minimum=$version;
                }
                $policies[$id]=['group'=>$group,'enabled'=>$enabled,'minimum'=>$minimum];
            }
            // Preserve the old engine-disable dependency, but not its whitelist membership.
            $parentDisabled = $groups->get('mihomo',collect())->contains(fn ($row)=>!(bool)$row->is_enabled);
            foreach ($policies as $id=>$policy) {
                $group=$policy['group'];
                $enabled=$policy['enabled'] && !(!$unified && $parentDisabled && in_array($id,self::MIHOMO,true));
                $target=$group->firstWhere('client_type',$id) ?? $group->first();
                if ($target) {
                    DB::table('v2_client_strategy')->whereIn('id',$group->pluck('id')->reject(fn ($value)=>$value===$target->id)->all())->delete();
                    DB::table('v2_client_strategy')->where('id',$target->id)->update(['client_type'=>$id,'is_enabled'=>(int)$enabled,'min_version'=>$policy['minimum']]);
                } else {
                    DB::table('v2_client_strategy')->insert(['client_type'=>$id,'client_name'=>$id,'is_enabled'=>(int)$enabled,'min_version'=>null,'sort'=>0,'created_at'=>time(),'updated_at'=>time()]);
                }
            }
            foreach (['v2_subscribe_log','v2_risk_rule_hit'] as $table) {
                foreach (self::ALIASES as $old=>$id) DB::table($table)->whereRaw('LOWER(TRIM(client_type)) = ?',[$old])->update(['client_type'=>$id]);
                foreach (self::CLIENTS as $id) DB::table($table)->whereRaw('LOWER(TRIM(client_type)) = ?',[$id])->update(['client_type'=>$id]);
            }
            DB::table('v2_risk_setting')->updateOrInsert(['key'=>'client_access_unified'],['value'=>'1','updated_at'=>time()]);
        });
    }
    public function down(): void {
        throw new RuntimeException('Canonical client data cannot be split back into old aliases. Restore a pre-upgrade database backup to roll back.');
    }
};