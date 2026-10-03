<?php
namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AppleAccountService;
use App\Services\UserService;
use Illuminate\Http\Request;

class AppleAccountController extends Controller
{
    public function fetch(Request $request, AppleAccountService $service)
    {
        abort_unless(config('v2board.apple_account_enable', 0), 404);
        $user = User::findOrFail($request->user['id']);
        abort_unless((new UserService)->isAvailable($user), 403, 'An active subscription or remaining credits are required.');
        try {
            $accounts = $service->accounts();
        } catch (\Throwable $e) {
            return response(['message' => 'Account temporarily unavailable.', 'code' => 'apple_unavailable'], 503)->header('Cache-Control', 'private, no-store');
        }
        return response(['data' => $accounts])->header('Cache-Control', 'private, no-store');
    }
}
