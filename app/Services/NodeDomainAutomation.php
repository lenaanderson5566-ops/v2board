<?php
namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Bounded reconciliation; network probes run outside the DNS lifecycle lock. */
final class NodeDomainAutomation
{
    private static function probeStatus(array $result): string
    {
        return match ($result['code']??'') {
            'dns_unavailable'=>'dns_unavailable',
            'dns_mismatch','dns_empty'=>'dns_mismatch',
            'udp_client_required'=>'manual_required',
            default=>'connection_failed',
        };
    }

    public function advance(int $id): void
    {
        $a=DB::table('v2_node_ddns')->find($id);
        if (!$a || $a->purpose==='entry' || !$a->managed || !$a->enabled) return;
        $node=ProxyService::model($a->node_type)::find($a->node_id);
        if (!$node || $node->service_id) return;
        if ($a->entry_id) return; // External forwarding still needs operator evidence.
        if ($a->published_domain===$a->domain && (int)$a->published_port===(int)$node->server_port && !in_array($a->tls_transition_state,['pending','failed'],true)) return;
        if (!NetworkServer::ready($a) || in_array($a->tls_transition_state,['pending','failed'],true)) return;
        if (!Cache::add('domain-auto-attempt:'.$id,true,60)) return;
        $proof=NodeDeploymentWorkflow::snapshot($node);
        $report=function(string $code)use($a){ Cache::put('domain-auto-state:'.$a->id,['revision'=>\App\Http\Controllers\V1\Admin\NodeDomainController::revision($a),'code'=>$code],900); };
        $runtime=NodeRuntimeService::inspect($a->node_type,$node);
        if ($runtime['runtimeStatus']!=='online' || $runtime['maintenance'] || $runtime['applicationState']!=='applied') { $report('runtime_pending'); return; }
        $probe=app(NodeDeploymentCheck::class);
        $addresses=NetworkServer::addresses($a);
        $expected=array_values($addresses);
        // TLS publication waits for the node's candidate certificate receipt.
        if ((int)$node->tls===1) {
            try { $actual=$probe->resolve($a->domain); } catch (\Throwable $e) { $report('dns_unavailable'); return; }
            $canonical=fn($ips)=>array_map(fn($ip)=>@inet_ntop(@inet_pton($ip)),$ips);
            $actual=$canonical($actual);$expected=$canonical($expected);
            if (!$actual || in_array(false,$actual,true) || array_diff($actual,$expected) || array_diff($expected,$actual)) { $report('dns_mismatch'); return; }
        } else {
            $result=$probe->endpoint($a->domain,(int)$node->server_port,null,in_array($node->protocol,['hysteria','hysteria2','tuic'],true),$expected);
            if ($result['state']!=='pass') { $report(self::probeStatus($result)); return; }
        }
        NodeDnsLifecycle::locked(function()use($id,$node,$proof,$report,$addresses){
            $node->refresh();$current=DB::table('v2_node_ddns')->find($id);
            if (!$current || NetworkServer::addresses($current)!==$addresses || $current->entry_id || !hash_equals($proof,NodeDeploymentWorkflow::snapshot($node))) return;
            $runtime=NodeRuntimeService::inspect($node->getTable()==='v2_server_v2box'?'v2box':'v2node',$node);
            if ($runtime['runtimeStatus']!=='online' || $runtime['maintenance'] || $runtime['applicationState']!=='applied') return;
            try { NodeDnsLifecycle::activateLocked($id); Cache::forget('domain-auto-state:'.$id); }
            catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
                if (!in_array($e->getStatusCode(),[409,422],true)) throw $e;
                $report('configuration_blocked');
            }
        });
    }
    public function connection(int $id): void
    {
        $row=DB::table('v2_node_connection')->find($id);
        if (!$row || $row->entry_id || !Cache::add('connection-auto-attempt:'.$id,true,60)) return;
        try {
            $draft=json_decode($row->draft,true,512,JSON_THROW_ON_ERROR);
            $plan=NodeConnection::plan($row->node_type,$draft);
            $published=json_decode($row->published??'null',true);
            $report=function(string $code)use($row,$plan){ Cache::put('connection-auto-state:'.$row->id,['proof'=>$plan['proof'],'code'=>$code],900); };
            if (($published['proof']??null)===$plan['proof'] || !$plan['dns_ready'] || $plan['transition_pending']) return;
            $service=ProxyService::model($row->node_type)::findOrFail($draft['service_id']);
            $runtime=NodeRuntimeService::inspect($row->node_type,$service);
            if ($runtime['runtimeStatus']!=='online' || $runtime['maintenance'] || $runtime['applicationState']!=='applied') { $report('runtime_pending'); return; }
            $origin=DB::table('v2_node_ddns')->find($plan['origin_id']);
            if (!$origin || $origin->tls_transition_state==='failed') { $report('configuration_blocked'); return; }
            $probe=app(NodeDeploymentCheck::class)->endpoint($plan['host'],$plan['port'],$plan['tls']===1?$plan['server_name']:null,in_array($plan['protocol'],['hysteria','hysteria2','tuic'],true),array_values(NetworkServer::addresses($origin)));
            if ($probe['state']!=='pass') { $report(self::probeStatus($probe)); return; }
            \App\Services\Actions\PublishNodeConnection::run(['type'=>$row->node_type,'id'=>$row->node_id,'revision'=>$row->revision,'proof'=>$plan['proof'],'confirmed'=>true]);
            Cache::forget('connection-auto-state:'.$id);
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            if (!in_array($e->getStatusCode(),[404,409,422],true)) throw $e;
            if (isset($report)) $report('configuration_blocked');
        }
    }

}
