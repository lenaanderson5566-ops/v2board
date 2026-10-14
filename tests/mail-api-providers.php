<?php
// Included by notification-delivery.php after its isolated database and transport setup.
use App\Exceptions\MailSendException;
use App\Services\{SesSender, ResendSender};
use Illuminate\Support\Facades\{Http, Crypt};

$data=app(App\Services\ProductMail::class)->data(['template_name'=>'test','language'=>'en-US']);
config(['v2board.email_from_address'=>'sender@example.test', 'v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST_SENTINEL')]);
$sender=new ResendSender;
$fakeHttp(['*'=>Http::response(['id'=>'receipt-123'],200)]);
$assert($sender->send('recipient@example.test',$data,'stable-delivery')==='receipt-123','Resend receipt missing');
Http::assertSent(fn($r)=>$r->url()==='https://api.resend.com/emails' && $r->hasHeader('Authorization','Bearer re_TEST_SENTINEL')
    && $r->hasHeader('Idempotency-Key','mail/'.hash('sha256','stable-delivery')) && $r['to']===['recipient@example.test'] && isset($r['html'],$r['text'])); $checks++;
foreach ([401=>'RESEND_AUTH_REJECTED',403=>'RESEND_AUTH_REJECTED',409=>'RESEND_IDEMPOTENCY_CONFLICT',422=>'RESEND_REQUEST_REJECTED',429=>'RESEND_RATE_LIMITED',500=>'RESEND_SERVER_UNKNOWN',302=>'RESEND_REQUEST_REJECTED'] as $status=>$code) {
    $fakeHttp(['*'=>Http::response('PRIVATE_RESPONSE', $status)]);
    try { $sender->send('recipient@example.test',$data,'stable-delivery'); throw new RuntimeException('Expected Resend rejection'); }
    catch (MailSendException $e) {
        $assert($e->safeCode===$code,'Resend status classification');
        $assert($e->retryable===($status===429) && $e->uncertain===($status===500),'Resend unsafe retries');
        $assert(!str_contains($e->getMessage(),'PRIVATE_RESPONSE'),'Resend response leaked');
    }
}
foreach ([Http::failedConnection(),Http::response(['id'=>"bad\nid"],200)] as $response) {
    $fakeHttp(['*'=>$response]);
    try { $sender->send('recipient@example.test',$data,'stable-delivery'); throw new RuntimeException('Expected uncertain Resend'); }
    catch (MailSendException $e) { $assert($e->uncertain && !$e->retryable,'Resend uncertain retried'); }
}
config(['v2board.email_provider'=>'resend']);
$fakeHttp(['*'=>Http::response(['id'=>'receipt-123'],200)]);
$job=new App\Jobs\SendEmailJob(['email'=>'recipient@example.test','template_name'=>'test']);
$copy=unserialize(serialize($job));
foreach ([$job,$copy] as $j) {
    $result=$j->handle(); $log=App\Models\MailLog::findOrFail($result['log_id']);
    $assert($log->provider==='resend' && $log->status==='accepted','Resend job routing/log failed');
}
$requests=Http::recorded();
$assert($requests[0][0]->header('Idempotency-Key')===$requests[1][0]->header('Idempotency-Key'),'Queue serialization changed idempotency key');

class TestSesSender extends SesSender {
    public array $options=[];
    public $response;
    public $command;
    protected function client(array $options): \Aws\SesV2\SesV2Client {
        $this->options=$options;
        $options['credentials']=['key'=>'TEST_ONLY','secret'=>'TEST_ONLY'];
        $options['handler']=function ($command) {
            $this->command=$command;
            if ($this->response instanceof Throwable) return \GuzzleHttp\Promise\Create::rejectionFor($this->response);
            return \GuzzleHttp\Promise\Create::promiseFor(new \Aws\Result($this->response));
        };
        return parent::client($options);
    }
}
$ses=new TestSesSender;
config(['v2board.email_ses_region'=>'ap-southeast-1','v2board.email_ses_auth'=>'role','v2board.email_ses_configuration_set'=>'delivery-events']);
$ses->response=['MessageId'=>'ses-message-123'];
$assert($ses->send('recipient@example.test',$data)==='ses-message-123','SES receipt failed');
$assert(!isset($ses->options['credentials']) && $ses->options['retries']===0,'SES role chain/retries incorrect');
$assert($ses->options['endpoint']==='https://email.ap-southeast-1.amazonaws.com' && $ses->options['http']['allow_redirects']===false,'SES endpoint not fixed');
$assert($ses->command['Destination']['ToAddresses']===['recipient@example.test'] && $ses->command['ConfigurationSetName']==='delivery-events','SES payload invalid');
$assert($ses->command['Content']['Simple']['Subject']['Charset']==='UTF-8','SES subject encoding');
config(['v2board.email_ses_auth'=>'key','v2board.email_ses_access_key'=>Crypt::encryptString('AKIA'.str_repeat('A',16)),
    'v2board.email_ses_secret_key'=>Crypt::encryptString('TEST_SECRET_SENTINEL')]);
$ses->send('recipient@example.test',$data);
$assert($ses->options['credentials']['secret']==='TEST_SECRET_SENTINEL','SES encrypted credentials failed');
foreach ([400,403,429,500,0] as $status) {
    $context=$status ? ['response'=>new \GuzzleHttp\Psr7\Response($status)] : [];
    $ses->response=new \Aws\Exception\AwsException('PRIVATE_AWS_RESPONSE',new \Aws\Command('SendEmail'),$context);
    try { $ses->send('recipient@example.test',$data); throw new RuntimeException('Expected SES rejection'); }
    catch (MailSendException $e) {
        $assert($e->retryable===($status===429) && $e->uncertain===($status===500 || !$status),'SES unsafe retries');
        $assert(!str_contains($e->getMessage(),'PRIVATE_AWS_RESPONSE'),'SES response leaked');
    }
}
$ses->response=['MessageId'=>'ses-job-receipt'];
$app->instance(SesSender::class,$ses);
config(['v2board.email_provider'=>'ses']);
$result=(new App\Jobs\SendEmailJob(['email'=>'recipient@example.test','template_name'=>'test']))->handle();
$assert(App\Models\MailLog::findOrFail($result['log_id'])->provider==='ses' && !$result['error'],'SES job routing');
foreach (['https://evil.test','us-east-1/../../','localhost'] as $region) {
    config(['v2board.email_ses_region'=>$region]);
    try { $ses->send('recipient@example.test',$data); throw new RuntimeException('Unsafe SES region accepted'); }
    catch (MailSendException $e) { $assert($e->safeCode==='SES_CONFIG_INVALID','SES invalid region classification'); }
}
config(['v2board.email_provider'=>'unknown']);
$result=(new App\Jobs\SendEmailJob(['email'=>'recipient@example.test','template_name'=>'test']))->handle();
$assert($result['error']==='MAIL_PROVIDER_INVALID','Unknown provider silently fell back to SMTP');
$rules=App\Http\Requests\Admin\ConfigSave::RULES;
foreach (['ses','resend'] as $provider) $assert(validator(['email_provider'=>$provider],['email_provider'=>$rules['email_provider']])->passes(),'Provider validation rejects supported channel');
foreach (['us-east-1','ap-southeast-1','eu-central-1'] as $region) $assert(validator(['email_ses_region'=>$region],['email_ses_region'=>$rules['email_ses_region']])->passes(),'SES region validation');
$request=Illuminate\Http\Request::create('/','GET',['key'=>'email']);
$response=(new App\Http\Controllers\V1\Admin\ConfigController)->fetch($request);
$encoded=$response->getContent();
$assert(!str_contains($encoded,'TEST_SECRET_SENTINEL') && !str_contains($encoded,'re_TEST_SENTINEL'),'Config exposed provider secrets');
$parsed=json_decode($encoded,true)['data']['email'];
foreach (['email_ses_access_key','email_ses_secret_key','email_resend_api_key'] as $field) {
    $assert($parsed[$field]==='' && !str_contains($encoded,config('v2board.'.$field)),'Encrypted credential returned in config');
}
$assert($parsed['email_ses_key_configured'] && $parsed['email_resend_key_configured'],'Configured flags missing');
foreach (['email_ses_region'=>'https://example.test','email_ses_access_key'=>'ASIA'.str_repeat('A',16),'email_resend_api_key'=>"re_test\r\nX: bad"] as $field=>$value) {
    $assert(validator([$field=>$value],[$field=>$rules[$field]])->fails(),'Unsafe credential/region accepted');
}
config(['v2board.email_ses_region'=>'us-east-1']);
$ses->response=['MessageId'=>null];
try { $ses->send('recipient@example.test',$data); throw new RuntimeException('SES malformed response accepted'); }
catch (MailSendException $e) { $assert($e->uncertain && !$e->retryable,'SES malformed response retried'); }
$invalidRequest=new class extends App\Http\Requests\Admin\ConfigSave {
    public array $testData=[];
    public function validated($key=null,$default=null) { return $this->testData; }
};
$invalidRequest->testData=['email_ses_access_key'=>'AKIA'.str_repeat('A',16)];
try { (new App\Http\Controllers\V1\Admin\ConfigController)->save($invalidRequest); throw new RuntimeException('Partial credential rotation accepted'); }
catch (Illuminate\Validation\ValidationException $e) { $checks++; }
config(['v2board.email_resend_api_key'=>null]);
$invalidRequest->testData=['email_provider'=>'resend'];
try { (new App\Http\Controllers\V1\Admin\ConfigController)->save($invalidRequest); throw new RuntimeException('Unconfigured Resend accepted'); }
catch (Illuminate\Validation\ValidationException $e) { $checks++; }
echo "PASS SES/Resend transports, queue routing, stable idempotency and safe failure handling\n";

foreach ([['Expected response code "250" but got code "550", with message "550 5.1.1 PRIVATE@example.test"',550,'5.1.1'], ['451 4.7.0 temporary',451,'4.7.0'], ['connection timed out',null,null]] as [$text,$expected,$enhanced]) {
    $assert(App\Services\MailDiagnosis::smtp(new RuntimeException($text))===[$expected,$enhanced],'SMTP response extraction failed');
}
foreach ([['5.1.1','address_review'],['5.7.1','policy'],['5.2.2','mailbox_full']] as [$enhanced,$category]) {
    $assert(App\Services\MailDiagnosis::advice('failed','SMTP_REJECTED',550,$enhanced)[0]===$category,'Unsafe recipient advice');
}
$assert(App\Services\MailDiagnosis::advice('failed','RESEND_AUTH_REJECTED',403,null)[0]==='configuration','API auth blamed recipient');
config(['v2board.email_provider'=>'resend','v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST_ONLY')]);
$fakeHttp(['*'=>Http::response([],429)]);
$result=(new App\Jobs\SendEmailJob(['email'=>'one@example.test','template_name'=>'test']))->handle();
$receipt=App\Models\MailLog::findOrFail($result['log_id']);
$assert($receipt->transport_code===429 && $receipt->user_id==$one->id,'Response code/user association missing');
$payload=json_decode((new App\Http\Controllers\V1\Admin\MailLogController)->fetch(Illuminate\Http\Request::create('/','GET',['transport_code'=>429]))->getContent(),true);
$assert($payload['total']>0 && $payload['data'][0]['diagnosis']==='temporary','Response filtering/advice failed');
config(['v2board.email_password'=>'PRIVATE_SMTP_SECRET']);
$encoded=(new App\Http\Controllers\V1\Admin\ConfigController)->fetch(Illuminate\Http\Request::create('/','GET',['key'=>'email']))->getContent();
$assert(!str_contains($encoded,'PRIVATE_SMTP_SECRET') && json_decode($encoded,true)['data']['email']['email_smtp_key_configured'],'SMTP secret leaked');
echo "PASS transport diagnostics, recipient review and SMTP credential privacy\n";

Illuminate\Support\Facades\Mail::swap(new class { public function forgetMailers() {} public function send(...$args) {} });
config(['v2board.email_provider'=>'smtp','v2board.email_host'=>'smtp.example.test','v2board.email_password_encrypted'=>true,'v2board.email_password'=>Crypt::encryptString('SMTP_ENCRYPTED_TEST')]);
$result=(new App\Jobs\SendEmailJob(['email'=>'one@example.test','template_name'=>'test']))->handle();
$assert(!$result['error'] && config('mail.password')==='SMTP_ENCRYPTED_TEST','Encrypted SMTP password not applied');
config(['v2board.email_password'=>'invalid-ciphertext']);
$result=(new App\Jobs\SendEmailJob(['email'=>'one@example.test','template_name'=>'test']))->handle();
$assert($result['error']==='SMTP_KEY_INVALID' && $result['permanent'],'Invalid encrypted password retried');
echo "PASS encrypted SMTP credentials and fail-closed decryption\n";
