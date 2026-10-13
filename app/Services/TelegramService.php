<?php
namespace App\Services;

use App\Jobs\SendTelegramJob;
use App\Models\User;
use \Curl\Curl;
use Illuminate\Mail\Markdown;

class TelegramService {
    protected $api;

    public function __construct($token = '')
    {
        $this->api = 'https://api.telegram.org/bot' . (is_string($token) && trim($token) !== '' ? $token : config('v2board.telegram_bot_token')) . '/';
    }

    public function sendMessage(int $chatId, string $text, string $parseMode = '')
    {
        if ($parseMode === 'markdown') {
            $text = str_replace('_', '\_', $text);
        }
        $this->request('sendMessage', [
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => $parseMode
        ]);
    }

    public function approveChatJoinRequest(int $chatId, int $userId)
    {
        $this->request('approveChatJoinRequest', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function declineChatJoinRequest(int $chatId, int $userId)
    {
        $this->request('declineChatJoinRequest', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function getMe()
    {
        // Cache plain data only; callers always receive the validated Telegram envelope.
        $key = 'telegram:bot:v2:'.hash('sha256', $this->api);
        $cache = \Illuminate\Support\Facades\Cache::store();
        $bot = $cache->get($key);
        if (!$this->validBotIdentity($bot)) {
            $response = $this->request('getMe');
            $result = $response->result ?? null;
            $bot = is_object($result) ? get_object_vars($result) : $result;
            if (!$this->validBotIdentity($bot)) {
                throw new \App\Exceptions\TelegramApiException();
            }
            $cache->put($key, $bot, 600);
        }
        return (object) ['ok' => true, 'result' => (object) $bot];
    }

    private function validBotIdentity($bot): bool
    {
        return is_array($bot)
            && isset($bot['id'], $bot['username'])
            && is_numeric($bot['id']) && (int) $bot['id'] > 0
            && ($bot['is_bot'] ?? false) === true
            && is_string($bot['username'])
            && preg_match('/^[A-Za-z0-9_]{5,32}$/D', $bot['username']) === 1;
    }

    public function setWebhook(string $url)
    {
        $commands = $this->discoverCommands(base_path('app/Plugins/Telegram/Commands'));
        $this->setMyCommands($commands);
        return $this->request('setWebhook', [
            'url' => $url,
            'allowed_updates' => json_encode(['message','callback_query','chat_join_request','chat_member','my_chat_member']),
            ...(str_contains($url, '/api/v10/webhooks/telegram') ? ['secret_token'=>md5(config('v2board.telegram_bot_token'))] : [])
        ]);
    }

    public function discoverCommands(string $directory): array
    {
        $commands = [];

        foreach (glob($directory . '/*.php') as $file) {
            $className = 'App\\Plugins\\Telegram\\Commands\\' . basename($file, '.php');

            if (!class_exists($className)) {
                require_once $file;
            }

            if (!class_exists($className)) {
                continue;
            }

            try {
                $ref = new \ReflectionClass($className);

                if (
                    $ref->hasProperty('command') &&
                    $ref->hasProperty('description')
                ) {
                    $commandProp = $ref->getProperty('command');
                    $descProp = $ref->getProperty('description');

                    $command = $commandProp->isStatic()
                        ? $commandProp->getValue()
                        : $ref->newInstanceWithoutConstructor()->command;

                    $description = $descProp->isStatic()
                        ? $descProp->getValue()
                        : $ref->newInstanceWithoutConstructor()->description;

                    $commands[] = [
                        'command' => ltrim($command, '/'),
                        'description' => $description,
                    ];
                }
            } catch (\ReflectionException $e) {
                continue;
            }
        }
        return $commands;
    }
    
    public function setMyCommands(array $commands)
    {
        $this->request('setMyCommands', [
            'commands' => json_encode($commands),
        ]);
    }

    public function call(string $method, array $params = []) { return $this->request($method, $params); }

    private function request(string $method, array $params = [])
    {
        $curl = new Curl();
        $curl->setOpt(CURLOPT_CONNECTTIMEOUT, 3);
        $curl->setOpt(CURLOPT_TIMEOUT, 8);
        $curl->setOpt(CURLOPT_FOLLOWLOCATION, false);
        $curl->post($this->api . $method, $params);
        $response = $curl->response;
        $curl->close();
        if (!isset($response->ok)) throw new \App\Exceptions\TelegramApiException();
        if (!$response->ok) {
            throw new \App\Exceptions\TelegramApiException((int)($response->error_code??0),(int)($response->parameters->retry_after??60));
        }
        return $response;
    }

    public function sendMessageWithAdmin($message, $isStaff = false)
    {
        if (!config('v2board.telegram_bot_enable', 0)) return;
        $users = User::where(function ($query) use ($isStaff) {
            $query->where('is_admin', 1);
            if ($isStaff) {
                $query->orWhere('is_staff', 1);
            }
        })
            ->where('telegram_id', '!=', NULL)
            ->get();
        foreach ($users as $user) {
            SendTelegramJob::dispatch($user->telegram_id, $message);
        }
    }
}
