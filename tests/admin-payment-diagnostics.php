<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\{Order, Payment, User};
use App\Payments\MGate;
use App\Services\{AuthService, PaymentAttemptHistory, PaymentCallbackHistory, PaymentGatewayTrace, PaymentService};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;
$n = 0;
$assert = \Tests\Support\Assertions::counter($n);
set_exception_handler(function ($e) { fwrite(STDERR,$e->getMessage()."\n".$e->getTraceAsString()."\n"); exit(1); });
config(['cache.default' => 'array']);
DB::beginTransaction();
try {
    $payment = Payment::create(['name'=>'Diagnostic test', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>['pid'=>'test', 'key'=>'test-secret']]);
    $order = Order::create(['user_id'=>1, 'plan_id'=>1, 'type'=>1, 'period'=>'month_price', 'trade_no'=>App\Utils\Helper::generateOrderNo(), 'total_amount'=>1000, 'status'=>0, 'payment_id'=>$payment->id]);
    $requestId = (string) Illuminate\Support\Str::uuid();
    PaymentCallbackHistory::record('PaytaroQR', $payment->uuid, $order->trade_no, 'settlement', 'failed', 'secret=should-not-be-stored', $requestId);
    $history = PaymentCallbackHistory::forOrder($order);
    $assert($history['events'][0]->reason === 'internal_error', 'Raw errors are redacted');
    $assert($history['events'][0]->request_id === $requestId, 'Request ID can correlate logs');
    $other = Payment::create(['name'=>'Other channel', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>[]]);
    PaymentCallbackHistory::record('PaytaroQR', $other->uuid, $order->trade_no, 'settlement', 'failed', 'channel mismatch', null);
    $assert(count(PaymentCallbackHistory::forOrder($order)['events']) === 1, 'Unrelated channel does not contaminate order history');
    $callbackBody = json_encode(['merchant_no'=>$order->trade_no, 'callback_no'=>'fixture', 'status'=>'PAID', 'order_amount'=>1, 'order_currency'=>'CNY']);
    $callbackPath = '/api/v10/webhooks/payments/PaytaroQR/' . $payment->uuid . '?signature=fixture-callback-query';
    $request = Request::create($callbackPath, 'POST', [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_X_APP_SECRET' => 'fixture-callback-secret', 'HTTP_COOKIE' => 'session=fixture-browser-session',
    ], $callbackBody);
    $request->attributes->set('requestId', $requestId);
    $app->instance('request', $request);
    try {
        (new App\Services\Actions\Guest\PaymentActions())->notify('PaytaroQR', $payment->uuid, $request);
        throw new RuntimeException('Invalid callback unexpectedly accepted');
    } catch (HttpException $error) {
        $assert($error->getStatusCode() === 500, 'Failed verification keeps provider failure response');
    }
    $history = PaymentCallbackHistory::forOrder($order);
    $callbackEvent = $history['channelEvents'][0];
    $channelCallback = PaymentCallbackHistory::forChannel($payment->id)->firstWhere('id', $callbackEvent->id);
    $assert(count($history['events']) === 1 && $callbackEvent->has_raw_diagnostic && !isset($callbackEvent->raw_diagnostic),
        'Failed callback raw availability does not attach an unverified callback to the order or expose the payload in lists');
    $assert($channelCallback?->has_raw_diagnostic && $channelCallback->trade_no === null
        && PaymentCallbackHistory::forChannel($payment->id)->firstWhere('id', $history['events'][0]->id)->trade_no === $order->trade_no,
        'The channel lists unassociated callbacks and links only verified order associations');
    $assert($order->fresh()->status === 0, 'Diagnostic recording does not settle an order');
    for ($i = 0; $i < 4; $i++) {
        try {
            (new App\Services\Actions\Guest\PaymentActions())->notify('PaytaroQR', $payment->uuid, $request);
            throw new RuntimeException('Invalid callback unexpectedly accepted');
        } catch (HttpException $error) {
            $assert($error->getStatusCode() === 500, 'Sampled-out callback retains the failure response');
        }
    }
    $assert(PaymentCallbackHistory::forChannel($payment->id)->where('stage', 'verification')->count() === 1,
        'Repeated unverified callbacks on the same channel keep one sample');

    $large = str_repeat('fixture-large-', 1024);
    $largeTrace = new PaymentGatewayTrace();
    $largeTrace->add('Fixture large body', $large);
    PaymentCallbackHistory::record('PaytaroQR', $other->uuid, null, 'verification', 'failed', 'verify error', $requestId, $largeTrace);
    $largeEvent = PaymentCallbackHistory::forChannel($other->id)->firstWhere('stage', 'verification');
    $sections = array_column(PaymentGatewayTrace::read(PaymentCallbackHistory::TABLE, $largeEvent->id)['sections'], 'text');
    $assert(strlen($sections[0]) === 8192 && str_starts_with($large, $sections[0]) && isset($sections[1]),
        'A different known channel gets its own bounded raw sample with a truncation notice');

    $unknownTrace = new PaymentGatewayTrace();
    $unknownTrace->add('Fixture', 'unknown-endpoint-content');
    foreach (['PaytaroQR', 'FakeProvider', 'AnotherFakeProvider'] as $provider) {
        PaymentCallbackHistory::record($provider, (string) Str::uuid(), null, 'channel', 'failed', 'Payment channel not found', $requestId, $unknownTrace);
    }
    $unknownEvents = DB::table(PaymentCallbackHistory::TABLE)->where('provider', 'unknown')->where('request_id', $requestId)->get();
    $assert($unknownEvents->count() === 1 && $unknownEvents[0]->raw_diagnostic === null,
        'Unknown endpoint IDs and provider names share one metadata-only sample');

    // An authenticated callback that fails amount validation remains fully diagnosable.
    $verifiedBody = json_encode(json_decode($callbackBody, true) + ['fixture_padding' => $large]);
    $verifiedRequest = Request::create($callbackPath, 'POST', [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_X_APP_SECRET' => 'test-secret',
    ], $verifiedBody);
    $app->instance('request', $verifiedRequest);
    try {
        (new App\Services\Actions\Guest\PaymentActions())->notify('PaytaroQR', $payment->uuid, $verifiedRequest);
        throw new RuntimeException('Mismatched amount unexpectedly accepted');
    } catch (HttpException $error) {
        $assert($error->getStatusCode() === 500 && $order->fresh()->status === 0,
            'A verified amount mismatch preserves the failure response and pending order');
    }
    $verifiedEvent = collect(PaymentCallbackHistory::forOrder($order)['events'])->firstWhere('reason', 'payment amount mismatch');
    $assert($verifiedEvent !== null, 'Verified callback bypasses the unverified sample window and remains linked to its order');
    $verifiedSections = array_column(PaymentGatewayTrace::read(PaymentCallbackHistory::TABLE, $verifiedEvent->id)['sections'], 'text', 'title');
    $assert($verifiedSections['回调请求内容'] === $verifiedBody, 'Verified callback retains raw content larger than the unverified limit');

    // An HTTP adapter uses the common transport and keeps exact response bytes and signed request contents.
    config(['cache.default' => 'array', 'fastai.app_url' => 'https://panel.example.test']);
    $mgate = Payment::create([
        'name'=>'MGate diagnostic fixture', 'payment'=>'MGate', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1,
        'notify_domain'=>'https://callbacks.example.test', 'config'=>[
            'mgate_url'=>'https://gateway.example.test', 'mgate_app_id'=>'fixture-app', 'mgate_app_secret'=>'fixture-signing-key',
        ],
    ]);
    $rawResponse = '{ "code": 1, "msg": "Notify domain rejected <script>fixture-message</script>", "secret": "fixture-response-secret", "link": "https://gateway.example.test/pay?t=fixture-full-link" }';
    $curl = new class($rawResponse) {
        public object $response;
        public bool $error = false;
        public int $httpStatusCode = 200;
        public string $rawResponseHeaders = "HTTP/1.1 200 OK\r\nX-Gateway-Header: fixture-header\r\n";
        public string $body;
        public function __construct(public string $rawResponse) { $this->response = json_decode($rawResponse); }
        public function setUserAgent($value) {}
        public function setOpt($key, $value) {}
        public function post($url, $body) { $this->body = $body; }
        public function close() {}
    };
    $service = new class($mgate->id, $curl) extends PaymentService {
        public function __construct(int $channelId, object $curl)
        {
            parent::__construct('MGate', $channelId);
            $this->payment = new class($this->config, $curl) extends MGate {
                public function __construct(array $config, private object $curl) { parent::__construct($config); }
                protected function createCurl() { return $this->curl; }
            };
        }
    };
    $attempt = new PaymentAttemptHistory((string) Str::uuid());
    $attempt->identify($order, $mgate->id);
    try {
        $service->pay($order->toArray() + ['stripe_token' => null], $attempt);
        throw new RuntimeException('Gateway fixture unexpectedly returned a payment entry');
    } catch (HttpException $error) {
        $assert($error->getStatusCode() === 500, 'Gateway failure preserves checkout failure response');
    }
    $attempt->finish('failed');
    $event = PaymentAttemptHistory::forOrder($order)['events'][0];
    $channelEvent = PaymentAttemptHistory::forChannel($mgate->id)['events'][0];
    $stored = DB::table(PaymentAttemptHistory::TABLE)->where('id', $event->id)->value('raw_diagnostic');
    $assert($event->has_raw_diagnostic && $channelEvent->id === $event->id && $channelEvent->has_raw_diagnostic
        && !isset($event->raw_diagnostic) && (int) $event->gateway_code === 1, 'Both history lists show only availability and gateway metadata');
    $assert(is_string($stored) && !str_contains($stored, 'fixture-response-secret')
        && !str_contains(Illuminate\Support\Facades\Crypt::decryptString($stored), 'fixture-signing-key'),
        'Gateway content is encrypted and a signing key that was never transmitted is not added to the trace');

    // Redirect-only channels record their full signed result through the same payment service.
    $epay = Payment::create(['name'=>'Redirect fixture', 'payment'=>'EPay', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1,
        'config'=>['url'=>'https://redirect.example.test', 'pid'=>'fixture-pid', 'key'=>'fixture-epay-key', 'type'=>'wxpay']]);
    $redirect = new PaymentAttemptHistory((string) Str::uuid());
    $redirect->identify($order, $epay->id);
    $result = (new PaymentService('EPay', $epay->id))->pay($order->toArray() + ['stripe_token' => null], $redirect);
    $redirect->finish('redirect_ready');
    $redirectEvent = PaymentAttemptHistory::forOrder($order)['events'][0];
    $assert($redirectEvent->has_raw_diagnostic && $redirectEvent->stage === 'provider'
        && str_contains($result['data'], '/submit.php?'), 'Redirect-only channels retain the result without claiming a server exchange');

    $legacySummary = ['format'=>'object', 'fields'=>['code'=>'missing']];
    $legacyId = DB::table(PaymentAttemptHistory::TABLE)->insertGetId([
        'order_id'=>$order->id, 'payment_id'=>$epay->id, 'provider'=>'EPay', 'stage'=>'gateway', 'result'=>'failed',
        'gateway_response'=>json_encode($legacySummary), 'created_at'=>time(),
    ]);
    $legacy = PaymentAttemptHistory::forOrder($order)['events']->firstWhere('id', $legacyId);
    $assert($legacy->gateway_response == $legacySummary && !$legacy->has_raw_diagnostic, 'Legacy summary remains available without raw history');

    $makeUser = static fn (bool $admin) => User::create([
        'email'=>'raw-diagnostic-' . (int) $admin . '@example.test', 'password'=>'fixture', 'is_admin'=>(int) $admin,
        'token'=>App\Utils\Helper::guid(), 'uuid'=>App\Utils\Helper::guid(true),
    ]);
    $adminAuth = new AuthService($makeUser(true));
    $userAuth = new AuthService($makeUser(false));
    $adminToken = $adminAuth->generateAuthData(Request::create('/'))['auth_data'];
    $userToken = $userAuth->generateAuthData(Request::create('/'))['auth_data'];
    $adminPath = config('fastai.secure_path', config('fastai.frontend_admin_path', hash('crc32b', config('app.key'))));
    $readRaw = static function (string $kind, int $id, ?string $authorization) use ($app, $adminPath) {
        $request = Request::create('/api/v1/' . $adminPath . '/payment/diagnostics/' . $kind . '/' . $id,
            'GET', [], [], [], ['HTTP_ACCEPT' => 'application/json']);
        if ($authorization !== null) $request->headers->set('Authorization', $authorization);
        return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    };
    try {
        $assert($readRaw('attempt', $event->id, null)->getStatusCode() === 403
            && $readRaw('attempt', $event->id, $userToken)->getStatusCode() === 403
            && $readRaw('callback', $callbackEvent->id, $userToken)->getStatusCode() === 403, 'Anonymous and ordinary users cannot read either raw diagnostic type');
        $response = $readRaw('attempt', $event->id, $adminToken);
        $sections = array_column(json_decode($response->getContent(), true)['data']['sections'], 'text', 'title');
        $assert($response->isSuccessful() && str_contains($response->headers->get('Cache-Control'), 'no-store')
            && $sections['请求内容 #1'] === $curl->body && $sections['响应内容 #1'] === $rawResponse
            && $sections['响应头 #1'] === $curl->rawResponseHeaders, 'Admin receives exact gateway body and signed request from the private raw endpoint');
        parse_str($sections['请求内容 #1'], $sent);
        $assert($sent['notify_url'] === $mgate->notify_domain . '/api/v10/webhooks/payments/MGate/' . $mgate->uuid
            && isset($sent['sign']), 'Actual callback and request signature remain visible to admin');
        $response = $readRaw('callback', $callbackEvent->id, $adminToken);
        $sections = array_column(json_decode($response->getContent(), true)['data']['sections'], 'text', 'title');
        $assert($sections['回调请求'] === 'POST ' . $callbackPath && $sections['回调请求内容'] === $callbackBody
            && str_contains($sections['回调请求头'], 'fixture-callback-secret') && !str_contains($sections['回调请求头'], 'fixture-browser-session'),
            'Callbacks preserve signed payment data and exclude unrelated browser cookies');
        $response = $readRaw('attempt', $redirectEvent->id, $adminToken);
        $sections = array_column(json_decode($response->getContent(), true)['data']['sections'], 'text', 'title');
        $assert(json_decode($sections['支付接口结果'], true) === $result, 'Admin sees the complete signed redirect URL');
        $assert($readRaw('attempt', $legacyId, $adminToken)->getStatusCode() === 404, 'Legacy records without original data use the summary');
    } finally {
        $adminAuth->removeAllSession();
        $userAuth->removeAllSession();
    }

    echo "PASS {$n} admin payment diagnostics checks\n";
} finally { DB::rollBack(); }
