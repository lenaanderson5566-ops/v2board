<?php
namespace App\Exceptions;

class TelegramApiException extends \Symfony\Component\HttpKernel\Exception\HttpException {
    public int $telegramCode;
    public int $retryAfter;
    public function __construct(int $code=0, int $retryAfter=60) {
        $this->telegramCode=$code;
        $this->retryAfter=max(1,min(86400,$retryAfter));
        parent::__construct(503,'Telegram service unavailable');
    }
}
