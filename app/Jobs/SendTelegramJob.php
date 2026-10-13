<?php

namespace App\Jobs;

use App\Services\TelegramService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendTelegramJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    protected $telegramId;
    protected $text;

    public $tries = 6;
    public $timeout = 10;

    public function backoff(): array { return [30,120,300,600]; }

    /**
     * Create a new job instance.
     *
     * @return void
     */
    public function __construct(int $telegramId, string $text)
    {
        $this->onQueue('send_telegram');
        $this->telegramId = $telegramId;
        $this->text = $text;
    }

    /**
     * Execute the job.
     *
     * @return void
     */
    public function handle()
    {
        if (!config('v2board.telegram_bot_enable',0)) return;
        $user=app(\App\Services\TelegramCommunityService::class)->userForTelegram($this->telegramId);
        if (!$user || $user->banned || (!$user->is_admin && !$user->is_staff)) return;
        if (\Illuminate\Support\Facades\Cache::has('telegram:admin-blocked:'.$this->telegramId)) return;
        try {
            (new TelegramService())->sendMessage($this->telegramId, $this->text);
        } catch (\App\Exceptions\TelegramApiException $e) {
            if ($e->telegramCode===403) {
                \Illuminate\Support\Facades\Cache::put('telegram:admin-blocked:'.$this->telegramId,true,86400);
                return;
            }
            if ($e->telegramCode===400) return;
            if ($e->telegramCode===429) { $this->release($e->retryAfter); return; }
            // A timeout may occur after delivery. Fail once instead of duplicating private messages.
            $this->fail($e);
        }
    }
}
