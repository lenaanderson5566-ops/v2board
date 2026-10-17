<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

final class FastaiInstallerService
{
    public const CHUNK_BYTES = 524288;
    public const MAX_BYTES = 536870912;

    private function root(bool $create = false): string
    {
        $root = storage_path('app/fastai-installers');
        if ($create && !is_dir($root) && !mkdir($root, 0750, true) && !is_dir($root)) abort(500, '无法创建安装包目录');
        return $root;
    }

    private function directory(string $id): string
    {
        abort_unless(preg_match('/^fastai-[a-f0-9-]{36}$/D', $id), 404);
        return $this->root().'/'.$id;
    }

    private function read(string $id): array
    {
        $path = $this->directory($id).'/metadata.json';
        abort_unless(is_file($path), 404, '安装包不存在');
        return json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    private function write(array $row): void
    {
        $path = $this->directory($row['id']).'/metadata.json';
        if (file_put_contents($path.'.tmp', json_encode($row, JSON_THROW_ON_ERROR)) === false || !rename($path.'.tmp', $path)) abort(500, '无法保存安装包记录');
    }

    private function locked(string $id, callable $fn)
    {
        $dir = $this->directory($id);
        abort_unless(is_dir($dir), 404);
        $lock = fopen($dir.'/upload.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) abort(503, '安装包暂时忙碌');
        try { return $fn($this->read($id), $dir); }
        finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    public function url(string $id): string
    {
        $origin = rtrim((string)config('v2board.app_url', config('app.url')), '/');
        $parts = parse_url($origin);
        abort_unless(($parts['scheme'] ?? '') === 'https' && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['query']) && !isset($parts['fragment']), 422, '请先把站点地址配置为公网 HTTPS 地址');
        return $origin.'/api/v10/public/client-installers/'.$id.'/content';
    }

    public function create(array $data): array
    {
        $extensions = ['windows'=>'/\.(exe|msi|zip)$/i', 'android'=>'/\.apk$/i', 'macos'=>'/\.(dmg|pkg|zip)$/i', 'linux'=>'/\.(deb|rpm|appimage|tar\.gz|zip)$/i'];
        abort_unless(preg_match($extensions[$data['platform']], $data['name']), 422, '安装包扩展名与目标系统不匹配');
        $id = 'fastai-'.Str::uuid();
        $url = $this->url($id);
        abort_unless(disk_free_space($this->root(true)) > $data['size'] * 2 + 104857600, 422, '磁盘空间不足，请至少预留安装包两倍大小及 100 MiB');
        $dir = $this->directory($id);
        if (!mkdir($dir, 0750)) abort(500, '无法创建上传目录');
        $row = $data + ['id'=>$id, 'status'=>'uploading', 'createdAt'=>gmdate('Y-m-d\TH:i:s\Z'), 'updatedAt'=>time()];
        $row['name'] = preg_replace('/[^a-zA-Z0-9._-]/', '_', $data['name']);
        $this->write($row);
        return $row + ['downloadUrl'=>$url, 'chunkBytes'=>self::CHUNK_BYTES];
    }

    public function chunk(string $id, int $index, UploadedFile $file): void
    {
        $this->locked($id, function ($row, $dir) use ($index, $file) {
            abort_unless($row['status'] === 'uploading', 409, '安装包已完成上传');
            $count = (int)ceil($row['size'] / self::CHUNK_BYTES);
            abort_unless($index >= 0 && $index < $count, 422, '分片编号无效');
            $size = min(self::CHUNK_BYTES, $row['size'] - $index * self::CHUNK_BYTES);
            abort_unless($file->getSize() === $size, 422, '分片大小不正确');
            $path = $dir.'/'.$index.'.part';
            if (is_file($path)) {
                abort_unless(hash_equals(hash_file('sha256', $path), hash_file('sha256', $file->getRealPath())), 409, '重试分片内容不一致');
                return;
            }
            abort_unless(disk_free_space($dir) > $size + 104857600, 422, '磁盘空间不足');
            $file->move($dir, $index.'.tmp');
            if (!rename($dir.'/'.$index.'.tmp', $path)) abort(500, '分片保存失败');
            $row['updatedAt'] = time();
            $this->write($row);
        });
    }

    public function complete(string $id): array
    {
        return $this->locked($id, function ($row, $dir) {
            if ($row['status'] === 'ready') return $row + ['downloadUrl'=>$this->url($row['id'])];
            abort_unless($row['status'] === 'uploading', 410, '上传已过期，请重新选择文件上传');
            $count = (int)ceil($row['size'] / self::CHUNK_BYTES);
            for ($i = 0; $i < $count; $i++) abort_unless(is_file($dir.'/'.$i.'.part'), 422, '分片不完整，请重试上传');
            abort_unless(disk_free_space($dir) > $row['size'] + 104857600, 422, '磁盘空间不足，无法合并安装包');
            $output = fopen($dir.'/package.tmp', 'wb');
            if (!$output) abort(500, '无法合并安装包');
            try {
                for ($i = 0; $i < $count; $i++) {
                    $input = fopen($dir.'/'.$i.'.part', 'rb');
                    try { if (stream_copy_to_stream($input, $output) === false) abort(500, '分片读取失败'); }
                    finally { fclose($input); }
                }
            } finally { fclose($output); }
            clearstatcache(true, $dir.'/package.tmp');
            abort_unless(filesize($dir.'/package.tmp') === $row['size'], 422, '安装包大小校验失败');
            $row['sha256'] = hash_file('sha256', $dir.'/package.tmp');
            if (!rename($dir.'/package.tmp', $dir.'/package.bin')) abort(500, '安装包保存失败');
            $row['status'] = 'ready';
            $this->write($row);
            for ($i = 0; $i < $count; $i++) unlink($dir.'/'.$i.'.part');
            return $row + ['downloadUrl'=>$this->url($row['id'])];
        });
    }

    public function listing(): array
    {
        $items = [];
        foreach (glob($this->root().'/fastai-*/metadata.json') as $path) {
            $row = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
            if ($row['status'] === 'ready') $items[] = $row + ['downloadUrl'=>$this->url($row['id'])];
        }
        usort($items, fn ($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
        return $items;
    }

    public function pruneIncomplete(): int
    {
        $count = 0;
        foreach (glob($this->root().'/fastai-*/metadata.json') as $path) {
            $id = basename(dirname($path));
            $count += $this->locked($id, function ($row, $dir) {
                if ($row['status'] !== 'uploading' || ($row['updatedAt'] ?? time()) >= time() - 86400) return 0;
                $row['status'] = 'expired';
                $this->write($row);
                foreach (glob($dir.'/*') as $file) {
                    if (preg_match('/^(?:\d+\.(?:part|tmp)|package\.(?:tmp|bin))$/D', basename($file)) && is_file($file)) unlink($file);
                }
                return 1;
            });
        }
        return $count;
    }

    public function validateRelease(array $release): void
    {
        $path = parse_url($release['downloadUrl'], PHP_URL_PATH);
        if (!preg_match('~/api/v10/public/client-installers/(fastai-[a-f0-9-]{36})/content$~D', $path ?? '', $match)) return;
        $row = $this->read($match[1]);
        abort_unless($row['status'] === 'ready' && is_file($this->directory($row['id']).'/package.bin'), 422, '安装包尚未上传完成');
        foreach (['platform', 'architecture', 'latestVersion', 'latestBuild', 'sha256'] as $field) {
            abort_unless((string)$row[$field] === (string)$release[$field], 422, '发布信息与上传记录不一致：'.$field);
        }
        abort_unless($release['downloadUrl'] === $this->url($row['id']), 422, '请使用当前站点生成的安装包地址');
    }

    public function serve(string $id)
    {
        $path = '/api/v10/public/client-installers/'.$id.'/content';
        $published = collect((new FastaiReleaseService())->publicDownloads())->first(fn ($r) => str_ends_with(parse_url($r['downloadUrl'], PHP_URL_PATH) ?? '', $path));
        abort_unless($published, 404);
        $row = $this->read($id);
        abort_unless($row['status'] === 'ready' && hash_equals($published['sha256'], $row['sha256']), 404);
        $file = $this->directory($id).'/package.bin';
        abort_unless(is_file($file), 404);
        return response()->download($file, $row['name'], ['Content-Type'=>'application/octet-stream', 'X-Content-Type-Options'=>'nosniff', 'Cache-Control'=>'private, no-store']);
    }
}
