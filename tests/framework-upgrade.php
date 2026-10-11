<?php
// Local only; real framework transports are exercised without network delivery.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function ($error) { fwrite(STDERR, $error->getMessage()."\n"); exit(1); });
$checks = 0;
$assert = function ($ok, $message) use (&$checks) {
    if (!$ok) throw new RuntimeException($message);
    $checks++;
};
$assert(str_starts_with($app->version(), '12.'), 'Unexpected framework version');
foreach (["a@example.com\r\nBcc:b@example.com", "a@example.com\n", "a@example.com\0", 'a @example.com'] as $email) {
    $assert(validator(['email'=>$email], ['email'=>'email'])->fails(), 'Unsafe email accepted');
}
$assert(!validator(['email'=>'valid+tag@example.com'], ['email'=>'email'])->fails(), 'Valid email rejected');
$request = Illuminate\Http\Request::create('http://panel.example/', 'GET', [], [], [], ['REMOTE_ADDR'=>'192.0.2.5']);
$request->headers->set('X-Forwarded-For', '198.51.100.10');
$request->headers->set('X-Forwarded-Proto', 'https');
$middleware = new App\Http\Middleware\TrustProxies;
$middleware->handle($request, function ($request) use ($assert) {
    $assert($request->ip() === '192.0.2.5' && !$request->isSecure(), 'Untrusted proxy headers accepted');
    return response('ok');
});
$middleware = new class extends App\Http\Middleware\TrustProxies { protected $proxies = ['192.0.2.5']; };
$middleware->handle($request, function ($request) use ($assert) {
    $assert($request->ip() === '198.51.100.10' && $request->isSecure(), 'Trusted proxy headers ignored');
    return response('ok');
});
Symfony\Component\HttpFoundation\Request::setTrustedProxies([], 0);
foreach ([['smtp',587,'tls'], ['smtps',465,'ssl'], ['smtp',25,null]] as [$scheme, $port, $encryption]) {
    config(['mail.driver'=>'smtp', 'mail.scheme'=>$scheme, 'mail.host'=>'smtp.example.test', 'mail.port'=>$port,
        'mail.encryption'=>$encryption, 'mail.username'=>'test-user', 'mail.password'=>'test-password', 'mail.timeout'=>15]);
    Illuminate\Support\Facades\Mail::forgetMailers();
    $transport = Illuminate\Support\Facades\Mail::mailer()->getSymfonyTransport();
    $assert($transport instanceof Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport, 'SMTP transport not created');
    $assert($transport->getStream()->getTimeout() === 15.0, 'SMTP timeout ignored');
    $assert($transport->getUsername() === 'test-user', 'SMTP credentials ignored');
}
config(['mail.driver'=>'array', 'mail.from.address'=>'sender@example.test']);
Illuminate\Support\Facades\Mail::forgetMailers();
$sent = Illuminate\Support\Facades\Mail::raw('framework upgrade test', function ($message) {
    $message->to('recipient@example.test')->subject('Local transport test');
});
$assert($sent instanceof Illuminate\Mail\SentMessage, 'Symfony mail send contract broken');
$disk = Illuminate\Support\Facades\Storage::disk('local');
$path = 'framework-tests/'.bin2hex(random_bytes(8)).'.txt';
try {
    $assert($disk->put($path, 'roundtrip') && $disk->get($path) === 'roundtrip', 'Flysystem write/read failed');
} finally { $disk->delete($path); }
echo "Laravel 12: $checks checks passed; no real mail sent.\n";
