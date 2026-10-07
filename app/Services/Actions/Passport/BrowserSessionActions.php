<?php
namespace App\Services\Actions\Passport;

use App\Services\AuthService;
use App\Services\BrowserSession;
use Illuminate\Http\Request;

final class BrowserSessionActions
{
    private function record(Request $request): array
    {
        abort_unless($request->attributes->has('browser.session'), 400, __('Invalid parameter'));
        return $request->attributes->get('browser.session');
    }

    public function show(Request $request)
    {
        return response()->json(['data'=>app(BrowserSession::class)->projection($this->record($request))]);
    }

    public function migrate(Request $request)
    {
        $record=$this->record($request);
        abort_unless(time() < strtotime((string)config('browser.legacy_exchange_until')), 410, __('Token error'));
        $credential=(string)$request->input('legacyToken');
        $record = \Illuminate\Support\Facades\Cache::lock('BROWSER_MIGRATION:'.hash('sha256',$credential),5)->block(3,function() use ($credential,$record,$request) {
            $user=AuthService::decryptAuthData($credential);
            abort_unless($user,401,__('Unauthenticated.'));
            abort_if($user['banned'] || ($record['scope']==='admin' && !$user['is_admin']),403,__('Account is disabled.'));
            $auth=new AuthService(\App\Models\User::findOrFail($user['id']));
            $new=$auth->generateAuthData($request)['auth_data'];
            $auth->removeCurrentSession($credential);
            app(BrowserSession::class)->destroy($record);
            return app(BrowserSession::class)->rotate($record,$new);
        });
        $request->attributes->set('browser.session',$record);
        return response()->json(['data'=>app(BrowserSession::class)->projection($record)]);
    }

    public function destroy(Request $request)
    {
        $record=$this->record($request);
        app(BrowserSession::class)->destroy($record);
        $request->attributes->set('browser.session',app(BrowserSession::class)->rotate($record,''));
        return response('',204);
    }
}
