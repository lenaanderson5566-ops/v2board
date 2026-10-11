<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
class ProcessNodeTrafficBatches extends Command {
    protected $signature='traffic:process-batches';
    protected $description='Recover durable V2Box traffic batches not yet processed';
    public function handle(): int {
        $ids=DB::table('v2_node_traffic_batch')->whereNull('processed_at')->orderBy('id')->limit(100)->pluck('id');
        foreach ($ids as $id) {
            try { \App\Services\Actions\NodeTrafficBatch::process((int)$id); }
            catch (\Throwable $e) { \Log::error('Node traffic batch processing failed', ['batchRecordId'=>$id]); }
        }
        return self::SUCCESS;
    }
}
