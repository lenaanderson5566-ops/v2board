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
        foreach (DB::table('v2_node_ddns as n')->join('v2_ddns_credential as c','c.id','=','n.credential_id')->where('n.enabled',true)->whereBetween('n.next_run',[0,time()])->whereBetween('c.next_run',[0,time()])->orderBy('n.next_run')->limit(100)->pluck('n.id') as $id) {
            $service->sync($id);
            if (microtime(true)>$deadline) break;
        }
        return 0;
    }
}
