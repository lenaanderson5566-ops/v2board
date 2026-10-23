<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;

final class NodeCredentials
{
    private static function model(string $type): string {
        abort_unless(in_array($type,['v2node','v2box'],true),422);
        return $type==='v2box' ? \App\Models\ServerV2box::class : \App\Models\ServerV2node::class;
    }
    private static function keys(string $type,int $id) {
        return DB::table('v2_node_credential')->where('node_type',$type)->where('node_id',$id);
    }
    public static function migrated(string $type,int $id): bool {
        return DB::table('v2_node_credential_state')->where('node_type',$type)->where('node_id',$id)->exists();
    }
    public static function legacyEnabled(): bool {
        return !self::migrated('global',0);
    }
    public static function authenticate(string $token,string $type,int $id,bool $bearer): void {
        if (in_array($type,['v2node','v2box'],true)) {
            $service=self::model($type)::find($id);
            abort_if($service && $service->service_id,401);
        }
        if (str_starts_with($token,'nk_')) {
            abort_unless($bearer && preg_match('/^nk_([a-f0-9]{32})\.([a-f0-9]{64})$/D',$token,$m),401);
            $key=DB::table('v2_node_credential')->where('id',$m[1])->first();
            abort_unless($key && !$key->revoked_at && (!$key->expires_at || $key->expires_at>time())
                && hash_equals($key->secret_hash,hash('sha256',$m[2])),401);
            abort_unless($key->node_type===$type && (int)$key->node_id===$id,403);
            // Auth reads authoritative state on every request; usage writes are at most once/minute.
            DB::table('v2_node_credential')->where('id',$key->id)
                ->where(function($q){$q->whereNull('last_used_at')->orWhere('last_used_at','<',time()-60);})
                ->update(['last_used_at'=>time()]);
            return;
        }
        $global=(string)config('v2board.server_token');
        abort_unless($global!=='' && hash_equals($global,$token),401);
        abort_unless(self::legacyEnabled() && !self::migrated($type,$id),401);
        if (in_array($type,['v2node','v2box'],true)) {
            $model=self::model($type); $node=$model::find($id);
            abort_if($node && $node->service_id && self::migrated($type,(int)$node->service_id),401);
        }
    }
    public static function listing(string $type,int $id): array {
        $model=self::model($type); abort_unless($model::find($id),404);
        $keys=self::keys($type,$id)->orderByDesc('created_at')->get()->map(function($k){
            return ['id'=>$k->id,'fingerprint'=>substr($k->id,0,12),
                'status'=>$k->revoked_at ? 'revoked' : ($k->expires_at && $k->expires_at<=time() ? 'expired' : ($k->expires_at ? 'retiring' : 'active')),
                'createdAt'=>$k->created_at,'createdBy'=>$k->created_by,'lastUsedAt'=>$k->last_used_at,
                'expiresAt'=>$k->expires_at,'revokedAt'=>$k->revoked_at,'revokedBy'=>$k->revoked_by];
        })->all();
        return ['migrated'=>self::migrated($type,$id),'legacyEnabled'=>self::legacyEnabled(),'keys'=>$keys,
            'legacyNodes'=>self::legacyNodes()];
    }
    public static function legacyNodes(): array {
        $states=DB::table('v2_node_credential_state')->get()->keyBy(fn($s)=>$s->node_type.':'.$s->node_id);
        $nodes=[];
        foreach(['v2node','v2box'] as $type) {
            $model=self::model($type);
            foreach($model::get(['id','name','service_id']) as $node) {
                // Virtual child nodes inherit their parent's connection.
                if (!$node->service_id && !isset($states[$type.':'.$node->id]))
                    $nodes[]=['type'=>$type,'id'=>(int)$node->id,'name'=>$node->name];
            }
        }
        return $nodes;
    }
    public static function disableLegacy(int $actor): void {
        abort_if(count(self::legacyNodes())>0,409,'仍有未迁移节点，请先完成独立凭据配置');
        foreach(['v2node','v2box'] as $type) {
            $model=self::model($type);
            foreach($model::where(function($q){$q->whereNull('service_id')->orWhere('service_id',0);})->pluck('id') as $id)
                abort_unless(self::keys($type,(int)$id)->whereNull('revoked_at')->whereNull('expires_at')->whereNotNull('last_used_at')->exists(),409,'请先确认所有节点已使用有效的新凭据连接');
        }
        DB::table('v2_node_credential_state')->updateOrInsert(['node_type'=>'global','node_id'=>0],['migrated_at'=>time()]);
    }
    public static function retire(string $type,int $id): void {
        self::keys($type,$id)->whereNull('revoked_at')->update(['revoked_at'=>time()]);
    }
    public static function issue(string $type,int $id,int $actor): array {
        return DB::transaction(function()use($type,$id,$actor){
            $model=self::model($type); $service=$model::whereKey($id)->lockForUpdate()->first(); abort_unless($service,404);
            abort_if($service->service_id,422,'接入线路使用关联代理服务的部署凭据');
            $now=time();
            // Only one pending rotation at a time. A second attempt must not silently discard a key.
            abort_if(self::keys($type,$id)->whereNull('revoked_at')->where('expires_at','>',$now)->exists(),409,'请先完成当前轮换或等待宽限期结束');
            self::keys($type,$id)->whereNull('revoked_at')->whereNull('expires_at')->update(['expires_at'=>$now+1800]);
            DB::table('v2_node_credential_state')->updateOrInsert(['node_type'=>$type,'node_id'=>$id],['migrated_at'=>$now]);
            $keyId=bin2hex(random_bytes(16)); $secret=bin2hex(random_bytes(32));
            DB::table('v2_node_credential')->insert(['id'=>$keyId,'node_type'=>$type,'node_id'=>$id,
                'secret_hash'=>hash('sha256',$secret),'created_at'=>$now,'created_by'=>$actor]);
            return ['id'=>$keyId,'secret'=>'nk_'.$keyId.'.'.$secret,'graceSeconds'=>1800];
        });
    }
    public static function revoke(string $type,int $id,string $keyId,int $actor): void {
        DB::transaction(function()use($type,$id,$keyId,$actor){
            $model=self::model($type); abort_unless($model::whereKey($id)->lockForUpdate()->first(),404);
            $key=self::keys($type,$id)->where('id',$keyId)->first(); abort_unless($key,404);
            if ($key->revoked_at) return;
            self::keys($type,$id)->where('id',$keyId)->update(['revoked_at'=>time(),'revoked_by'=>$actor]);
        });
    }
}
