<?php
namespace App\Http\Controllers\V1\User;

class TelegramController extends \App\Http\Controllers\Controller
{
    public function getBotInfo()
    {
        return app(\App\Services\Actions\User\TelegramActions::class)->getBotInfo();
    }
}
