<?php
namespace App\Services\Actions\User;
use App\Models\User;
use App\Services\TelegramService;
use App\Services\TelegramCommunityService;
use Illuminate\Http\Request;
class TelegramActions {
    private function user(): User { return User::findOrFail(request()->user['id']); }
    public function getBotInfo() {
        $data=app(TelegramCommunityService::class)->status($this->user());
        // Reading local binding status must not depend on Telegram availability.
        $data['username']=null;
        return response(['data'=>$data]);
    }
    public function bindingLink(Request $request) {
        return response(['data'=>app(TelegramCommunityService::class)->bindingLink($this->user())],201);
    }
    public function confirmBinding(Request $request) {
        app(TelegramCommunityService::class)->confirmBinding($this->user(),(string)$request->input('telegramId'));
        return response(['data'=>true]);
    }
    public function joinLink(Request $request) {
        return response(['data'=>app(TelegramCommunityService::class)->joinLink($this->user())],201);
    }
}
