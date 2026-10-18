<?php
namespace App\Http\Controllers\V10;
use Illuminate\Http\Request;
use App\Services\Mail\MailAudience;
use App\Services\Mail\MailWebhook;
class MailController extends \App\Http\Controllers\Controller
{
    public function webhook(Request $request,string $provider) { app(MailWebhook::class)->receive($provider,$request); return response('ok',200); }
    public function unsubscribe(Request $request,string $token)
    {
        $user=MailAudience::recipient($token); abort_unless($user,404,__('Invalid unsubscribe link'));
        $done=false;
        if ($request->isMethod('POST')) {
            abort_unless($request->input('List-Unsubscribe')==='One-Click',422);
            $user->update(['announcement_email'=>0]); $done=true;
        }
        return response()->view('mail.unsubscribe',['done'=>$done,'language'=>$user->language ?: 'en-US'])->header('Cache-Control','no-store')->header('Referrer-Policy','no-referrer')->header('X-Robots-Tag','noindex')->header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    }
}
