<?php

namespace App\Services\Actions\User;


use App\Models\User;
use App\Services\TelegramService;
use Illuminate\Http\Request;

class TelegramActions
{
    public function getBotInfo()
    {
        $telegramService = new TelegramService();
        $response = $telegramService->getMe();
        return response([
            'data' => [
                'username' => $response->result->username
            ]
        ]);
    }

    public function unbind(Request $request)
    {
        $user = User::where('user_id', $request->user['id'])->first();
    }
}
