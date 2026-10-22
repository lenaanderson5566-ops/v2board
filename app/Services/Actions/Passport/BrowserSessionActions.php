<?php
namespace App\Services\Actions\Passport;

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

    public function destroy(Request $request)
    {
        $record=$this->record($request);
        app(BrowserSession::class)->destroy($record);
        $request->attributes->set('browser.session',app(BrowserSession::class)->rotate($record,''));
        return response('',204);
    }
}
