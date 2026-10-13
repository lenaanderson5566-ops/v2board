<?php

namespace App\Services\Actions\Guest;


use App\Services\TelegramService;
use Illuminate\Http\Request;

class TelegramActions
{
    protected $msg;
    protected $commands = [];
    protected $telegramService;

    public function __construct(Request $request)
    {
        $secret = $request->is('api/v10/*') ? $request->header('X-Telegram-Bot-Api-Secret-Token') : $request->input('access_token');
        $token = config('v2board.telegram_bot_token');
        if (!config('v2board.telegram_bot_enable', 0) || !is_string($token) || trim($token) === '' ||
            !is_string($secret) || !hash_equals(md5($token), $secret)) {
            abort(401);
        }

        $this->telegramService = new TelegramService();
    }

    public function webhook(Request $request)
    {
        $updateId=$request->input('update_id');
        abort_unless(is_int($updateId) && $updateId>=0,422,'Invalid Telegram update');
        $key='telegram:update:'.hash('sha256',(string)config('v2board.telegram_bot_token')).':'.$updateId;
        \Illuminate\Support\Facades\Cache::lock($key.':lock',60)->block(2,function () use ($key,$request) {
            if (\Illuminate\Support\Facades\Cache::has($key)) return;
            $this->formatMessage($request->input());
            app(\App\Services\TelegramCommunityService::class)->handleUpdate($request->input());
            $this->handle();
            \Illuminate\Support\Facades\Cache::put($key,true,86400);
        });
    }

    public function handle()
    {
        if (!$this->msg) return;
        $msg = $this->msg;
        if (!$msg->is_private || (int)$msg->sender_id!==(int)$msg->chat_id) return;
        \Illuminate\Support\Facades\Cache::forget('telegram:admin-blocked:'.$msg->sender_id);
        if (!\Illuminate\Support\Facades\Cache::add('telegram:command-rate:'.$msg->sender_id,true,2)) return;
        $commandName = explode('@', $msg->command);

        // To reduce request, only commands contains @ will get the bot name
        if (count($commandName) == 2) {
            $botName = $this->getBotName();
            if ($commandName[1] === $botName){
                $msg->command = $commandName[0];
            }
        }

        try {
            foreach (glob(base_path('app//Plugins//Telegram//Commands') . '/*.php') as $file) {
                $command = basename($file, '.php');
                if (!in_array($command, ['Start', 'Bind', 'UnBind', 'Group'], true)) continue;
                $class = '\\App\\Plugins\\Telegram\\Commands\\' . $command;
                if (!class_exists($class)) continue;
                $instance = new $class();
                if ($msg->message_type === 'message') {
                    if (!isset($instance->command)) continue;
                    if ($msg->command !== $instance->command) continue;
                    $instance->handle($msg);
                    return;
                }
                if ($msg->message_type === 'reply_message') {
                    if (!isset($instance->regex)) continue;
                    if (!preg_match($instance->regex, $msg->reply_text, $match)) continue;
                    $instance->handle($msg, $match);
                    return;
                }
            }
        } catch (\Exception $e) {
            $this->telegramService->sendMessage($msg->chat_id, '操作未完成，请回到网站刷新绑定状态，或重新获取绑定链接。');
        }
    }

    public function getBotName()
    {
        $response = $this->telegramService->getMe();
        return $response->result->username;
    }

    private function formatMessage(array $data)
    {
        if (!isset($data['message'])) return;
        if (!isset($data['message']['text'])) return;
        $obj = new \StdClass();
        $text = explode(' ', $data['message']['text']);
        $obj->command = $text[0];
        $obj->args = array_slice($text, 1);
        $obj->chat_id = $data['message']['chat']['id'];
        $obj->sender_id = $data['message']['from']['id'] ?? 0;
        $obj->sender_name = $data['message']['from']['username'] ?? $data['message']['from']['first_name'] ?? '';
        $obj->message_id = $data['message']['message_id'];
        $obj->message_type = 'message';
        $obj->text = $data['message']['text'];
        $obj->is_private = $data['message']['chat']['type'] === 'private';
        if (isset($data['message']['reply_to_message']['text'])) {
            $obj->message_type = 'reply_message';
            $obj->reply_text = $data['message']['reply_to_message']['text'];
        }
        $this->msg = $obj;
    }

}
