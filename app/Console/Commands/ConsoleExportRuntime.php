<?php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Support\FrontendRuntime;

class ConsoleExportRuntime extends Command
{
    protected $signature = 'console:export-runtime {--api-origin= : HTTPS backend origin} {--output= : Existing directory for public frontend configuration} {--mode= : user or admin; omit to export both}';
    protected $description = 'Export public runtime configuration for independently hosted user and admin frontends';

    public function handle()
    {
        $origin = rtrim((string) $this->option('api-origin'), '/');
        $url = parse_url($origin);
        if (!$url || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) || !empty($url['path'])) {
            $this->error('Provide an HTTPS backend origin without a path or credentials.');
            return 1;
        }
        $directory = realpath($this->option('output') ?: public_path('console'));
        if (!$directory || !is_dir($directory)) { $this->error('Output directory does not exist.'); return 1; }
        $modes = $this->option('mode') ? [$this->option('mode')] : ['user', 'admin'];
        if (array_diff($modes, ['user', 'admin'])) { $this->error('Mode must be user or admin.'); return 1; }
        foreach ($modes as $mode) {
            $config = FrontendRuntime::config($mode);
            $config['apiBaseUrl'] = $origin;
            $config['clientMirrors'] = array_map(fn($link) => $origin . parse_url($link, PHP_URL_PATH), $config['clientMirrors']);
            if (file_put_contents($directory . '/' . $mode . '-config.json', json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n") === false) {
                $this->error('Could not write runtime configuration.');
                return 1;
            }
        }
        $this->info('Exported public user-config.json and admin-config.json. Deploy each only with its corresponding frontend.');
        return 0;
    }
}
