<?php
namespace App\Jobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
class DownloadClientMirror implements ShouldQueue {
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    public $tries=1; public $timeout=660; public $failOnTimeout=true; public $id;
    public function __construct(string $id){$this->id=$id;$this->onConnection('redis-mirror');$this->onQueue('client-download');}
    public function handle(\App\Services\ClientMirrorService $service){$service->download($this->id);}
    public function failed(\Throwable $e){(new \App\Services\ClientMirrorService)->fail($this->id,'任务失败或超时，请检查下载队列后重试');}
}
