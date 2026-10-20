<?php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\ObservabilityMonitor;
use Illuminate\Support\Facades\Cache;

final class MonitorSystem extends Command
{
    protected $signature='system:monitor';
    protected $description='Collect bounded health, queue and performance alerts for the administrator dashboard';
    public function handle(): int
    {
        try {
            $lock=Cache::lock('observability:monitor:lock',120);
            if (!$lock->get()) return 0;
            try {
                $result=app(ObservabilityMonitor::class)->inspect();
                $active=count(array_filter($result['alerts'],fn($item)=>$item['state']==='firing'));
                $this->line("System monitor complete: {$active} active alerts.");
                return $active ? 1 : 0;
            } finally {$lock->release();}
        } catch (\Throwable $error) {
            $this->error('System monitor unavailable; check database and cache services.');
            return 2;
        }
    }
}
