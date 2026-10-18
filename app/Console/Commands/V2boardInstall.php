<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Encryption\Encrypter;
use App\Models\User;
use App\Utils\Helper;
use Illuminate\Support\Facades\DB;

class V2boardInstall extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'v2board:install';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'v2board 安装';

    /**
     * Execute the console command.
     *
     * @return mixed
     */
    public function handle(): int
    {
        try {
            $this->info("__     ______  ____                      _  ");
            $this->info("\ \   / /___ \| __ )  ___   __ _ _ __ __| | ");
            $this->info(" \ \ / /  __) |  _ \ / _ \ / _` | '__/ _` | ");
            $this->info("  \ V /  / __/| |_) | (_) | (_| | | | (_| | ");
            $this->info("   \_/  |_____|____/ \___/ \__,_|_|  \__,_| ");
            if (\File::exists(base_path() . '/.env')) {
                $securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
                $this->info("访问 http(s)://你的站点/{$securePath} 进入管理面板，你可以在用户中心修改你的密码。");
                abort(500, '检测到已有 .env，拒绝重复安装；旧站请使用 update.sh 升级。');
            }

            if (!copy(base_path() . '/.env.example', base_path() . '/.env')) {
                abort(500, '复制环境文件失败，请检查目录权限');
            }
            $this->saveToEnv([
                'APP_KEY' => 'base64:' . base64_encode(Encrypter::generateKey('AES-256-CBC')),
                'DB_HOST' => $this->ask('请输入数据库地址（默认:localhost）', 'localhost'),
                'DB_DATABASE' => $this->ask('请输入数据库名'),
                'DB_USERNAME' => $this->ask('请输入数据库用户名'),
                'DB_PASSWORD' => $this->secret('请输入数据库密码')
            ]);
            \Artisan::call('config:clear');
            \Artisan::call('config:cache');
            try {
                DB::connection()->getPdo();
            } catch (\Exception $e) {
                abort(500, '数据库连接失败');
            }
            $file = \File::get(base_path() . '/database/install.sql');
            if (!$file) {
                abort(500, '数据库文件不存在');
            }
            $this->info('正在导入数据库请稍等...');
            $this->importDatabase($file);
            $this->info('数据库导入完成');
            $email = '';
            while (!$email) {
                $email = $this->ask('请输入管理员邮箱?');
            }
            $password = Helper::guid(false);
            if (!$this->registerAdmin($email, $password)) {
                abort(500, '管理员账号注册失败，请重试');
            }

            $this->info('一切就绪');
            $this->info("管理员邮箱：{$email}");
            $this->info("管理员密码：{$password}");

            $defaultSecurePath = hash('crc32b', config('app.key'));
            $this->info("访问 http(s)://你的站点/{$defaultSecurePath} 进入管理面板，你可以在用户中心修改你的密码。");
            return self::SUCCESS;
        } catch (\Throwable $e) {
            $this->error($e->getMessage());
            return self::FAILURE;
        }
    }

    private function registerAdmin($email, $password)
    {
        $user = new User();
        $user->email = $email;
        if (strlen($password) < 8) {
            abort(500, '管理员密码长度最小为8位字符');
        }
        $user->password = password_hash($password, PASSWORD_DEFAULT);
        $user->uuid = Helper::guid(true);
        $user->token = Helper::guid();
        $user->is_admin = 1;
        return $user->save();
    }

    private function importDatabase(string $sql): void
    {
        if (trim($sql) === '') throw new \RuntimeException('数据库文件为空');
        $connection = DB::connection();
        if ($connection->getSchemaBuilder()->getTables($connection->getDatabaseName())) {
            throw new \RuntimeException('数据库非空，拒绝安装；旧站请使用 update.sh 升级。');
        }
        try {
            // The trusted install dump contains comments and SQL string literals;
            // splitting it at semicolons can corrupt valid statements.
            if (!DB::unprepared($sql)) throw new \RuntimeException('SQL execution failed');
        } catch (\Throwable $e) {
            // Do not print SQL/bindings or credentials from the underlying exception.
            throw new \RuntimeException('数据库导入失败，请检查数据库权限和安装文件；保留现场排错，不要在旧库重复安装。', 0, $e);
        }
    }

    private function saveToEnv(array $data = []): void
    {
        $path = app()->environmentFilePath();
        $contents = file_get_contents($path);
        if ($contents === false) throw new \RuntimeException('读取环境文件失败');
        foreach ($data as $key => $value) {
            $key = strtoupper($key);
            if (!preg_match('/^[A-Z_][A-Z0-9_]*$/D', $key)) throw new \InvalidArgumentException('Invalid environment key');
            $escaped = strtr((string)$value, ["\\" => "\\\\", '"' => '\\"', '$' => '\\$', "\n" => '\\n', "\r" => '\\r']);
            $line = $key.'="'.$escaped.'"';
            $pattern = '/^'.preg_quote($key, '/').'=[^\r\n]*/m';
            $contents = preg_match($pattern, $contents)
                ? preg_replace_callback($pattern, fn() => $line, $contents)
                : rtrim($contents, "\r\n")."\n".$line."\n";
        }
        if (file_put_contents($path, $contents, LOCK_EX) !== strlen($contents)) {
            throw new \RuntimeException('保存环境文件失败，请检查目录权限');
        }
    }
}
