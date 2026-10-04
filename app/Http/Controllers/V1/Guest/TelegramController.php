<?php
namespace App\Http\Controllers\V1\Guest;

class TelegramController extends \App\Http\Controllers\Controller
{
    public function webhook(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Guest\TelegramActions::class)->webhook($request);
    }
}
