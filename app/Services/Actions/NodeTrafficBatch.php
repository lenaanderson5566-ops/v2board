<?php
namespace App\Services\Actions;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class NodeTrafficBatch
{
    public static function receive($node, string $batchId, array $data): int
    {
        return DB::transaction(function () use ($node,$batchId,$data) {
        ksort($data, SORT_NUMERIC);
        $payload = json_encode((object) $data, JSON_THROW_ON_ERROR);
        $hash = hash('sha256', $payload);
        $key = ['node_type'=>'v2box','node_id'=>$node->id,'batch_id'=>strtolower($batchId)];
        // Unique constraint serializes concurrent retries; a receipt always contains its durable work.
        $inserted=DB::table('v2_node_traffic_batch')->insertOrIgnore($key + [
            'payload_hash'=>$hash,'payload'=>$payload,'rate'=>$node->rate,
            'record_timezone'=>\App\Services\TimeZones::system(),'record_at'=>strtotime(date('Y-m-d')),'created_at'=>time(),
        ]);
        $row = DB::table('v2_node_traffic_batch')->where($key)->first();
        abort_unless($row, 500);
        abort_unless(hash_equals($row->payload_hash, $hash), 409, 'Batch payload conflict');
        if($inserted){$u=0;$d=0;foreach($data as $bytes){$u+=$bytes[0];$d+=$bytes[1];}
          \App\Services\ServerTrafficBudgetService::record(\App\Services\ServerTrafficBudgetService::budgetId('v2box',(int)$node->id,true),$u,$d,(int)$row->record_at);
        }
        return (int) $row->id;
        },3);
    }

    public static function process(int $id): void
    {
        if (Redis::exists('traffic_reset_lock')) return;
        DB::transaction(function () use ($id) {
            $row = DB::table('v2_node_traffic_batch')->where('id',$id)->lockForUpdate()->first();
            if (!$row || $row->processed_at !== null) return;
            $data = json_decode($row->payload, true, 512, JSON_THROW_ON_ERROR);
            $uploads=[]; $downloads=[]; $u=0; $d=0; $now=time();
            foreach ($data as $userId=>$bytes) {
                $uploads[$userId] = (int) ($bytes[0] * $row->rate);
                $downloads[$userId] = (int) ($bytes[1] * $row->rate);
                $u += $bytes[0]; $d += $bytes[1];
            }
            ApplyTraffic::apply($uploads,$downloads);
            // Atomic increments use existing unique daily-stat keys, retaining raw bytes and rate.
            foreach (array_chunk($data, 500, true) as $chunk) {
                $values=[]; $bindings=[];
                foreach ($chunk as $userId=>$bytes) {
                    $values[]='(?,?,?,?,?,?,?,?,?)';
                    array_push($bindings,$userId,$row->rate,$bytes[0],$bytes[1],'d',$row->record_at,$now,$now,$row->record_timezone??'Asia/Shanghai');
                }
                DB::statement('INSERT INTO v2_stat_user (user_id,server_rate,u,d,record_type,record_at,created_at,updated_at,record_timezone) VALUES '.implode(',', $values).' ON DUPLICATE KEY UPDATE u=u+VALUES(u),d=d+VALUES(d),updated_at=VALUES(updated_at)', $bindings);
            }
            DB::statement('INSERT INTO v2_stat_server (server_id,server_type,u,d,record_type,record_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE u=u+?,d=d+?,updated_at=?',
                [$row->node_id,$row->node_type,$u,$d,'d',$row->record_at,$now,$now,$u,$d,$now]);
            // Compact permanent tombstone prevents late retries from billing again.
            DB::table('v2_node_traffic_batch')->where('id',$id)->update(['processed_at'=>$now,'payload'=>null]);
        }, 3);
    }
}
