<?php
namespace App\Services;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Crypt,Http,Cache};
class MailWebhook
{
    private function secret(string $provider): string
    {
        try { $key=Crypt::decryptString((string)config('v2board.email_'.$provider.'_webhook_key')); }
        catch (\Throwable $e) { abort(403,'Webhook not configured'); }
        abort_if($key==='',403); return $key;
    }
    public function receive(string $provider, Request $request): void
    {
        $raw=$request->getContent(); abort_if(strlen($raw)>131072,413);
        $body=json_decode($raw,true); abort_unless(is_array($body),400);
        match($provider) { 'resend'=>$this->resend($request,$raw,$body), 'mailgun'=>$this->mailgun($body), 'ses'=>$this->ses($body), default=>abort(404) };
    }
    private function resend(Request $request,string $raw,array $body): void
    {
        $id=(string)$request->header('svix-id'); $at=(string)$request->header('svix-timestamp');
        abort_unless(preg_match('/^[A-Za-z0-9_-]{1,255}$/D',$id) && ctype_digit($at) && abs(time()-(int)$at)<=300,403);
        $secret=$this->secret('resend'); abort_unless(str_starts_with($secret,'whsec_'),403);
        $key=base64_decode(substr($secret,6),true); abort_unless(is_string($key) && strlen($key)>=16,403);
        $signature=base64_encode(hash_hmac('sha256',$id.'.'.$at.'.'.$raw,$key,true)); $valid=false;
        $header=(string)$request->header('svix-signature'); abort_if(strlen($header)>2048,403);
        foreach(explode(' ',$header) as $value) if (str_starts_with($value,'v1,') && hash_equals($signature,substr($value,3))) $valid=true;
        abort_unless($valid,403);
        $state=match($body['type'] ?? '') { 'email.delivered'=>'delivered','email.complained'=>'complained','email.delivery_delayed'=>'temporary','email.failed','email.suppressed'=>'rejected','email.bounced'=>strtolower($body['data']['bounce']['type'] ?? '')==='permanent' ? 'bounced' : 'rejected', default=>null };
        if (!$state) return;
        foreach(array_slice((array)($body['data']['to'] ?? []),0,50) as $email) app(MailFeedback::class)->record('resend',$id,(string)($body['data']['email_id'] ?? ''),(string)$email,$state,strtotime($body['created_at'] ?? '') ?: (int)$at);
    }
    private function mailgun(array $body): void
    {
        $sig=$body['signature'] ?? []; $at=(string)($sig['timestamp'] ?? ''); $token=(string)($sig['token'] ?? '');
        // Mailgun can retry events for hours; timestamp tolerance includes its retry window.
        abort_unless(ctype_digit($at) && (int)$at<=time()+300 && (int)$at>=time()-86400 && preg_match('/^[A-Za-z0-9]{16,128}$/D',$token),403);
        abort_unless(hash_equals(hash_hmac('sha256',$at.$token,$this->secret('mailgun')),(string)($sig['signature'] ?? '')),403);
        $event=$body['event-data'] ?? []; $state=match($event['event'] ?? '') {
            'delivered'=>'delivered','complained'=>'complained','unsubscribed'=>'unsubscribed',
            'failed'=>($event['severity'] ?? '')==='temporary' ? 'temporary' : (in_array($event['delivery-status']['enhanced-code'] ?? '',['5.1.1','5.1.2','5.1.3','5.2.1'],true) ? 'bounced' : 'rejected'),default=>null };
        if (!$state) return;
        app(MailFeedback::class)->record('mailgun',$token,(string)($event['message']['headers']['message-id'] ?? ''),(string)($event['recipient'] ?? ''),$state,(int)($event['timestamp'] ?? $at));
    }
    private function ses(array $body): void
    {
        $topic=(string)config('v2board.email_ses_topic_arn');
        abort_unless(preg_match('/^arn:aws:sns:([a-z0-9-]+):[0-9]{12}:[A-Za-z0-9_-]+$/D',$topic,$m) && ($body['TopicArn'] ?? '')===$topic,403);
        $host='sns.'.$m[1].'.amazonaws.com'; $cert=(string)($body['SigningCertURL'] ?? '');
        abort_unless(preg_match('~^https://'.preg_quote($host,'~').'/SimpleNotificationService-[a-fA-F0-9]{32,64}\.pem$~D',$cert),403);
        $at=strtotime($body['Timestamp'] ?? '') ?: 0;
        // SNS retries reuse original timestamps; permanent dedupe accompanies this bounded window.
        abort_if($at>time()+300 || $at<time()-23*86400,403);
        $type=$body['Type'] ?? ''; abort_unless(in_array($type,['Notification','SubscriptionConfirmation'],true),403);
        $keys=$type==='Notification' ? ['Message','MessageId','Subject','Timestamp','TopicArn','Type'] : ['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type'];
        $signed=''; foreach($keys as $key) { if ($key==='Subject' && !isset($body[$key])) continue; abort_unless(isset($body[$key]) && is_string($body[$key]),403); $signed.=$key."\n".$body[$key]."\n"; }
        $version=$body['SignatureVersion'] ?? ''; abort_unless(in_array($version,['1','2'],true),403);
        $signature=base64_decode($body['Signature'] ?? '',true); abort_unless($signature!==false,403);
        try {
            $pem=Cache::remember('sns-cert:'.hash('sha256',$cert),3600,function() use($cert) {
                $r=Http::connectTimeout(3)->timeout(5)->withOptions(['allow_redirects'=>false])->get($cert);
                if (!$r->successful() || strlen($r->body())>32768) throw new \RuntimeException('SNS_CERT_UNAVAILABLE');
                return $r->body();
            });
            $certificate=openssl_x509_parse($pem);
            $valid=is_array($certificate) && ($certificate['validFrom_time_t'] ?? PHP_INT_MAX)<=time() && ($certificate['validTo_time_t'] ?? 0)>=time() && openssl_verify($signed,$signature,$pem,$version==='2' ? OPENSSL_ALGO_SHA256 : OPENSSL_ALGO_SHA1)===1;
        } catch (\Throwable $e) { abort(503,'SNS certificate unavailable'); }
        abort_unless($valid,403);
        if ($type==='SubscriptionConfirmation') {
            $url=$body['SubscribeURL']; $parts=parse_url($url); parse_str($parts['query'] ?? '',$query);
            abort_unless(($parts['scheme'] ?? '')==='https' && ($parts['host'] ?? '')===$host && ($parts['path'] ?? '/')==='/' && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port']) && !isset($parts['fragment']) && ($query['Action'] ?? '')==='ConfirmSubscription' && ($query['TopicArn'] ?? '')===$topic && ($query['Token'] ?? '')===$body['Token'],403);
            // Call a constructed fixed AWS endpoint; never follow a URL supplied by the message.
            $response=Http::connectTimeout(3)->timeout(5)->withOptions(['allow_redirects'=>false])->get('https://'.$host.'/', ['Action'=>'ConfirmSubscription','TopicArn'=>$topic,'Token'=>$body['Token']]);
            abort_unless($response->successful(),503); return;
        }
        $event=json_decode($body['Message'],true); abort_unless(is_array($event),422);
        $kind=strtolower($event['notificationType'] ?? $event['eventType'] ?? '');
        $state=match($kind) { 'delivery'=>'delivered','complaint'=>'complained','bounce'=>($event['bounce']['bounceType'] ?? '')==='Permanent' ? 'bounced' : 'temporary',default=>null };
        if (!$state) return;
        $recipients=match($kind) { 'bounce'=>array_column($event['bounce']['bouncedRecipients'] ?? [],'emailAddress'),'complaint'=>array_column($event['complaint']['complainedRecipients'] ?? [],'emailAddress'),default=>$event['delivery']['recipients'] ?? [] };
        foreach(array_slice($recipients,0,50) as $email) app(MailFeedback::class)->record('ses',$body['MessageId'],(string)($event['mail']['messageId'] ?? ''),(string)$email,$state,strtotime($event[$kind]['timestamp'] ?? '') ?: $at);
    }
}
