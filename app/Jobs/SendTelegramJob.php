<?php

namespace App\Jobs;

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
        // Consume previously queued notifications without sending retired messages.
    }
}
