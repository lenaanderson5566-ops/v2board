<?php
namespace App\Exceptions;

class MailSendException extends \RuntimeException
{
    public function __construct(public string $safeCode, public bool $retryable = false, public bool $uncertain = false, public ?int $transportCode = null)
    {
        parent::__construct($safeCode);
    }
}
