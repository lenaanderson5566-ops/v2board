<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

class ConsoleVerify extends Command
{
    protected $signature = 'console:verify {--host= : Hostname used by visitors, without scheme}';
    protected $description = 'Verify committed console assets and Laravel page rendering without opening maintenance mode';

    public function handle()
    {
        $originalRequest = app('request');
        try {
            $root = realpath(public_path('console'));
            if (!$root) throw new \RuntimeException('Missing public/console; deploy the target branch production assets.');
            $manifest = json_decode(file_get_contents($root . '/.vite/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
            if (empty($manifest['index.html']['file']) || empty($manifest['admin.html']['file'])) throw new \RuntimeException('Invalid Vite entry in manifest.');
            foreach ($manifest as $record) {
                foreach (array_merge([$record['file'] ?? ''], $record['css'] ?? []) as $file) {
                    $path = realpath($root . '/' . $file);
                    if (!$file || !$path || strpos($path, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($path) || filesize($path) === 0) {
                        throw new \RuntimeException('Missing or invalid console asset: ' . $file);
                    }
                }
                foreach (array_merge($record['imports'] ?? [], $record['dynamicImports'] ?? []) as $key) {
                    if (!isset($manifest[$key])) throw new \RuntimeException('Unresolved Vite import: ' . $key);
                }
            }
            $host = $this->option('host') ?: parse_url(config('v2board.app_url', ''), PHP_URL_HOST) ?: 'localhost';
            if (!preg_match('/^[a-zA-Z0-9.-]+$/', $host)) throw new \RuntimeException('Provide a hostname without scheme, path or port.');
            if (config('v2board.safe_mode_enable', 0) && config('v2board.app_url') && !parse_url(config('v2board.app_url'), PHP_URL_HOST)) {
                throw new \RuntimeException('Safe mode app_url must be a full URL including https://.');
            }
            $admin = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
            foreach (['/' => 'user', '/app' => 'user', '/' . $admin => 'admin'] as $path => $mode) {
                $request = Request::create('https://' . $host . $path, 'GET');
                app()->instance('request', $request);
                // Run only the matched page action: keep real HTTP maintenance protection active.
                $route = Route::getRoutes()->match($request);
                $result = $route->run();
                $html = $result instanceof \Illuminate\Contracts\View\View ? $result->render() : response($result)->getContent();
                if (strpos($html, 'window.V2BOARD') === false || strpos($html, '/console/' . $manifest[$mode === 'admin' ? 'admin.html' : 'index.html']['file']) === false || strpos($html, 'data-console="' . $mode . '"') === false) {
                    throw new \RuntimeException('Old or incorrect page at ' . $path . '; check deployed routes and route/view caches.');
                }
                $this->info('Verified ' . $path . ' (' . $mode . ')');
            }
            $this->info('Console assets and CLI Laravel routes verified. Restart PHP-FPM and check public HTTP responses separately.');
            return 0;
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $error) {
            $this->error('Page returned ' . $error->getStatusCode() . '; check app_url host and safe_mode_enable. No domain protection was disabled.');
            return 1;
        } catch (\Throwable $error) {
            $this->error($error->getMessage());
            return 1;
        } finally {
            app()->instance('request', $originalRequest);
        }
    }
}
