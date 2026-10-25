<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Services\NodeDdnsService;
class SyncNodeDdns extends Command {
    protected $signature='nodes:sync-ddns';
    protected $description='Update Cloudflare DNS from recent scoped node reports';
    public function handle(NodeDdnsService $service) {
        $deadline=microtime(true)+50;
        $cleanupDeadline=microtime(true)+15;
        foreach (DB::table('v2_node_dns_record as r')->join('v2_ddns_credential as c','c.id','=','r.credential_id')->whereBetween('r.delete_after',[1,time()])->whereBetween('r.next_run',[0,time()])->whereBetween('c.next_run',[0,time()])->orderBy('r.next_run')->limit(10)->pluck('r.id') as $id) {
            try { app(\App\Services\NodeDnsLifecycle::class)->cleanup($id); }
            catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) { if ($e->getStatusCode()!==409) throw $e; break; }
            if (microtime(true)>$cleanupDeadline) break;
        }
        foreach (DB::table('v2_node_ddns as n')->join('v2_ddns_credential as c','c.id','=','n.credential_id')->where('n.enabled',true)->whereBetween('n.next_run',[0,time()])->whereBetween('c.next_run',[0,time()])->orderBy('n.next_run')->limit(100)->pluck('n.id') as $id) {
            try { $service->sync($id); if (microtime(true)<$deadline-15) app(\App\Services\NodeDomainAutomation::class)->advance($id); }
            catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) { if ($e->getStatusCode()!==409) throw $e; break; }
            if (microtime(true)>$deadline) break;
        }
        // Bounded round-robin avoids starving later connections when an earlier one is blocked.
        $cursor=(int)\Illuminate\Support\Facades\Cache::get('connection-auto-cursor',0);
        $ids=DB::table('v2_node_connection')->whereNull('entry_id')->where('id','>',$cursor)->orderBy('id')->limit(100)->pluck('id');
        if ($ids->isEmpty()) \Illuminate\Support\Facades\Cache::put('connection-auto-cursor',0,86400);
        foreach ($ids as $id) {
            if (microtime(true)>$deadline-15) break;
            app(\App\Services\NodeDomainAutomation::class)->connection($id);
            \Illuminate\Support\Facades\Cache::put('connection-auto-cursor',$id,86400);
        }
        return 0;
    }
}
