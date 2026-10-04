<?php

namespace App\Console\Commands;

use App\Services\ClientReleaseService;
use Illuminate\Console\Command;

class CheckClientReleases extends Command
{
    protected $signature = 'clients:check-releases';
    protected $description = 'Check stable releases of supported open-source clients';

    public function handle(ClientReleaseService $service)
    {
        foreach (ClientReleaseService::CLIENTS as $id => $client) {
            try {
                $state = $service->check($id);
                $this->line($client['name'] . ': ' . ($state['error'] ?? $state['version'] ?? '检查中'));
            } catch (\Throwable $e) {
                $this->warn($client['name'] . ': 检查失败，继续其他项目');
                report($e);
            }
        }
        return 0;
    }
}
