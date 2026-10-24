<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use App\Services\Actions\NodeConfiguration;
use App\Services\Actions\NodeV10Config;

class NodeRuntimeService
{
    public static function record(string $type, int $id, array $configuration, string $contract): void
    {
        Cache::put(\App\Utils\CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $id), time(), 3600);
        $hash = hash('sha256', json_encode($configuration));
        $previous = Cache::get("NODE_CONFIG_FETCH:{$type}:{$id}");
        Cache::put("NODE_CONFIG_FETCH:{$type}:{$id}", [
            'changedAt' => ($previous['hash'] ?? null) === $hash ? ($previous['changedAt'] ?? time()) : time(),
            'hash' => $hash,
            'providedAt' => time(), 'contract' => $contract,
        ], 86400);
    }

    /** A saved change is not a node acknowledgement. Preserve historical receipts. */
    public static function invalidate(string $type, int $id): void
    {
        Cache::forget("NODE_CONFIG_FETCH:{$type}:{$id}");
    }

    public static function connection(?int $checked, ?int $pushed, bool $blocked): string
    {
        if (!$checked && !$pushed) return 'unknown';
        if (max($checked ?? 0, $pushed ?? 0) < time() - 300) return 'offline';
        return $blocked ? 'limited' : 'online';
    }

    /** Ignore delayed reports for a different configuration; never store exception text. */
    public static function receipt(int $id, array $report): void
    {
        $last=Cache::get("NODE_CONFIG_FETCH:v2box:{$id}");
        if (!$last || !hash_equals($last['hash'],$report['hash'])) return;
        $key="NODE_CONFIG_RECEIPT:v2box:{$id}";
        $old=Cache::get($key,[]);
        $same=($old['hash'] ?? null)===$report['hash'] && ($old['state'] ?? null)===$report['state'] && ($old['errorCode'] ?? null)===($report['errorCode'] ?? null);
        Cache::put($key,$report+['reportedAt'=>$same ? $old['reportedAt'] : time(),
            'lastAppliedAt'=>$report['state']==='applied' ? ($same ? $old['lastAppliedAt'] : time()) : ($old['lastAppliedAt'] ?? null)],86400);
    }

    public static function application(?array $last, ?array $receipt): string
    {
        return $last && $receipt && hash_equals($last['hash'],$receipt['hash']) ? $receipt['state'] : 'unconfirmed';
    }

    public static function decorate(array $nodes): array
    {
        $policies=NodeMaintenance::active();
        $keys=[];
        foreach ($nodes as $node) {
            $root=($node['service_id'] ?? null) ?: $node['id'];
            foreach (['NODE_CONFIG_FETCH','NODE_CONFIG_RECEIPT','V2BOX_CAPABILITIES'] as $prefix)
                $keys[]=$prefix==='V2BOX_CAPABILITIES' ? $prefix.':'.$root : $prefix.':'.$node['type'].':'.$root;
        }
        $cache=$keys ? Cache::many(array_values(array_unique($keys))) : [];
        foreach ($nodes as &$node) {
            $root=($node['service_id'] ?? null) ?: $node['id'];$type=$node['type'];
            $last=$cache["NODE_CONFIG_FETCH:{$type}:{$root}"] ?? null;
            $receipt=$cache["NODE_CONFIG_RECEIPT:{$type}:{$root}"] ?? null;
            $capabilities=$type==='v2box' ? ($cache["V2BOX_CAPABILITIES:{$root}"] ?? []) : [];
            $node['maintenance']=NodeMaintenance::effective($policies,$type,$node['id'],$node['service_id'] ?? null);
            $node['application_state']=self::application($last,$receipt);
            $node['core_version']=$capabilities['coreVersion'] ?? null;
            $node['issues']=[];
            if ($node['maintenance']) continue;
            $status=self::connection($node['last_check_at'] ?? null,$node['last_push_at'] ?? null,(bool)($node['traffic_budget']['blocked'] ?? false));
            if ($status==='offline' || ($status==='unknown' && !empty($node['show']) && !empty($node['created_at']) && time()-$node['created_at']>600)) $node['issues'][]='offline';
            if ($node['application_state']==='failed') $node['issues'][]='configuration_failed';
            if ($last && $node['application_state']==='unconfirmed' && time()-($last['changedAt'] ?? $last['providedAt'])>600
                && in_array('configuration-receipt-v1',$capabilities['features'] ?? [],true)) $node['issues'][]='configuration_unconfirmed';
            $budget=$node['traffic_budget'] ?? [];
            if (!empty($budget['limitBytes']) && ($budget['usedBytes'] ?? 0)>=$budget['limitBytes']*0.9) $node['issues'][]='quota';
        }
        unset($node);
        return $nodes;
    }

    public static function alertConditions(array $nodes): array
    {
        $labels=['offline'=>'节点通信中断','configuration_failed'=>'节点配置应用失败',
            'configuration_unconfirmed'=>'节点配置长时间未确认','quota'=>'节点流量额度不足'];
        $conditions=[];
        foreach ($labels as $issue=>$label) {
            $affected=array_values(array_filter($nodes,fn($n)=>empty($n['service_id']) && empty($n['maintenance']) && in_array($issue,$n['issues'] ?? [],true)));
            if (!$affected) continue;
            $names=array_map(fn($n)=>$n['type'].' #'.$n['id'],array_slice($affected,0,5));
            $conditions['nodes:'.$issue]=['label'=>$label,'message'=>count($affected).' 个节点：'.implode('、',$names).'。请在节点管理中筛选异常节点。',
                'severity'=>in_array($issue,['offline','configuration_failed'],true) ? 'critical' : 'warning'];
        }
        return $conditions;
    }

    public static function inspect(string $type, $node): array
    {
        $id = (int) ($node->service_id ?: $node->id);
        $root = $node->service_id ? (new ServerService())->getServer($id, $type) : $node;
        abort_unless($root, 404, '代理服务不存在');
        $last = Cache::get("NODE_CONFIG_FETCH:{$type}:{$id}");
        $capabilities = $type === 'v2box' ? Cache::get("V2BOX_CAPABILITIES:{$id}") : null;
        $state = 'unknown';
        if ($last) {
            try {
                $configuration = $last['contract'] === 'v10' ? NodeV10Config::build($root) : NodeConfiguration::build($root);
                $state = hash_equals($last['hash'], hash('sha256', json_encode($configuration))) ? 'provided' : 'pending';
            } catch (\Throwable $e) { $state = 'invalid'; }
        }
        $receipt=Cache::get("NODE_CONFIG_RECEIPT:{$type}:{$id}");
        $application=self::application($last,$receipt);
        if ($state==='pending' || $state==='invalid') $application='unconfirmed';
        $maintenance=NodeMaintenance::active();
        $lastCheck=Cache::get(\App\Utils\CacheKey::get('SERVER_'.strtoupper($type).'_LAST_CHECK_AT',$id));
        $lastPush=Cache::get(\App\Utils\CacheKey::get('SERVER_'.strtoupper($type).'_LAST_PUSH_AT',$id));
        return ['configurationState' => $state,
            'lastCheckAt'=>$lastCheck,'lastPushAt'=>$lastPush,
            'runtimeStatus'=>self::connection($lastCheck,$lastPush,ServerTrafficBudgetService::blocked($type,$id)),
            'maintenance'=>NodeMaintenance::effective($maintenance,$type,(int)$node->id,$node->service_id),
            'ownMaintenance'=>$maintenance[$type.':'.$node->id] ?? null,
            'receiptAt'=>$receipt['reportedAt'] ?? null,'lastAppliedAt'=>$receipt['lastAppliedAt'] ?? null,
            'errorCode'=>$application==='failed' ? ($receipt['errorCode'] ?? 'core') : null,
            'receiptSupported'=>in_array('configuration-receipt-v1',$capabilities['features'] ?? [],true), 'providedAt' => $last['providedAt'] ?? null,
            'applicationState' => $application, 'inheritedFrom' => $node->service_id ? $id : null,
            'coreVersion' => $capabilities['coreVersion'] ?? null,
            'capabilitiesReportedAt' => $capabilities['reportedAt'] ?? null];
    }
}
