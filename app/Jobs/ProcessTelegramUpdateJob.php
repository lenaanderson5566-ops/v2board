<?php
namespace App\Jobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
class ProcessTelegramUpdateJob implements ShouldQueue {
    use Dispatchable,InteractsWithQueue,Queueable,SerializesModels;
    public $tries=1; public $timeout=60;
    public function __construct(public int $updateId) { $this->onQueue('send_telegram'); }
    public function handle(): void { app(\App\Services\TelegramDeliveryService::class)->process($this->updateId); }
}
