<?php
namespace App\Jobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
class ProcessNodeTrafficBatch implements ShouldQueue {
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    public $tries=3;
    public $timeout=120;
    public function __construct(public int $batchId) { $this->onQueue('traffic_fetch'); }
    public function handle(): void { \App\Services\Actions\NodeTrafficBatch::process($this->batchId); }
}
