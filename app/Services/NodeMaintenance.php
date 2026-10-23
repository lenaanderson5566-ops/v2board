<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;

final class NodeMaintenance
{
    public static function active(): array
    {
        return DB::table('v2_node_maintenance')->where('ends_at', '>', time())->get()->mapWithKeys(fn($row) => [
            $row->type.':'.$row->node_id => ['active'=>true, 'reason'=>$row->reason,
                'hideSubscription'=>(bool)$row->hide_subscription, 'endsAt'=>(int)$row->ends_at,
                'nodeId'=>(int)$row->node_id],
        ])->all();
    }

    public static function effective(array $policies, string $type, int $id, ?int $serviceId): ?array
    {
        // Service maintenance covers all associated connections.
        return ($serviceId ? ($policies[$type.':'.$serviceId] ?? null) : null) ?? ($policies[$type.':'.$id] ?? null);
    }

    public static function hidden(array $policies, string $type, int $id, ?int $serviceId): bool
    {
        return !empty($policies[$type.':'.$id]['hideSubscription']) || ($serviceId && !empty($policies[$type.':'.$serviceId]['hideSubscription']));
    }

    public static function save(string $type, int $id, array $input): void
    {
        if (!$input['enabled']) {
            DB::table('v2_node_maintenance')->where('type',$type)->where('node_id',$id)->delete();
            return;
        }
        abort_unless($input['endsAt'] > time() && $input['endsAt'] <= time()+30*86400, 422, '维护结束时间须在未来 30 天内');
        DB::table('v2_node_maintenance')->upsert([
            ['type'=>$type,'node_id'=>$id,'reason'=>$input['reason'],
                'hide_subscription'=>$input['hideSubscription'],'ends_at'=>$input['endsAt'],'updated_at'=>time()],
        ], ['type','node_id'], ['reason','hide_subscription','ends_at','updated_at']);
    }
}
