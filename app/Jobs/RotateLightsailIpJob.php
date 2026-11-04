<?php

namespace App\Jobs;

use App\Services\LightsailService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
#[\Illuminate\Queue\Attributes\Connection("redis-infrastructure")]
#[\Illuminate\Queue\Attributes\Queue("infrastructure")]
#[\Illuminate\Queue\Attributes\Tries(1)]
#[\Illuminate\Queue\Attributes\Timeout(180)]
class RotateLightsailIpJob implements ShouldQueue
{
    use Queueable;
    // Old serialized jobs have no attempt and can only handle legacy rows.
    public ?string $attempt = null;

    public function __construct(public int $serverId, ?string $attempt = null)
    {
        $this->attempt = $attempt;
    }
    public function handle(): void
    {
        (new LightsailService())->run($this->serverId, $this->attempt);
    }
    public function failed(?\Throwable $e): void
    {
        if ($this->attempt !== null) LightsailService::markWorkerFailed($this->serverId, $this->attempt);
    }
}
