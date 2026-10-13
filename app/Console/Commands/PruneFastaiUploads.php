<?php

namespace App\Console\Commands;

use App\Services\FastaiInstallerService;
use Illuminate\Console\Command;

final class PruneFastaiUploads extends Command
{
    protected $signature = 'fastai:prune-uploads';
    protected $description = 'Remove incomplete FastAI upload data after 24 hours of inactivity';

    public function handle(FastaiInstallerService $service): int
    {
        $this->info('Expired uploads: '.$service->pruneIncomplete());
        return 0;
    }
}
