<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
#[\Illuminate\Queue\Attributes\Connection("redis-infrastructure")]
#[\Illuminate\Queue\Attributes\Queue("infrastructure")]
#[\Illuminate\Queue\Attributes\Tries(1)]
#[\Illuminate\Queue\Attributes\Timeout(180)]
class RotateLightsailIpJob implements ShouldQueue
{
    use Queueable;
    public function __construct(public int $serverId)
    {
    }
    public function handle(): void
    {
        (new \App\Services\LightsailService())->run($this->serverId);
    }
    public function failed(?\Throwable $e): void
    {
        \Illuminate\Support\Facades\DB::table('v2_lightsail_server')->where('id', $this->serverId)->whereIn('status', ['queued', 'running'])->update(['status' => 'failed', 'error_code' => 'worker_failed']);
    }
}
