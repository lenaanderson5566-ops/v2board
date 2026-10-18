<?php
namespace App\Services\Mail;

use App\Exceptions\MailSendException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;

class ResendSender
{
    public ?int $responseCode = null;
    public function send(string $recipient, array $data, string $deliveryId): string
    {
        MailBlocklist::enforce($recipient);
        $from = (string) config('v2board.email_from_address');
        if (validator(['email'=>$from], ['email'=>'required|email:rfc'])->fails()) throw new MailSendException('RESEND_CONFIG_INVALID');
        try { $key = Crypt::decryptString((string) config('v2board.email_resend_api_key')); }
        catch (\Throwable $e) { throw new MailSendException('RESEND_KEY_INVALID'); }
        if (!preg_match('/^re_[A-Za-z0-9_-]+$/D', $key)) throw new MailSendException('RESEND_KEY_INVALID');
        $body = ['from'=>(new \Symfony\Component\Mime\Address($from, $data['brand']))->toString(),
            'to'=>[$recipient], 'subject'=>$data['subject'],
            'html'=>view('mail.product.message', $data)->render(), 'text'=>view('mail.product.text', $data)->render()];
        if (!empty($data['unsubscribeUrl'])) $body['headers']=['List-Unsubscribe'=>'<'.$data['unsubscribeUrl'].'>','List-Unsubscribe-Post'=>'List-Unsubscribe=One-Click'];
        try {
            $response = Http::withToken($key)->withHeaders(['Idempotency-Key'=>'mail/'.hash('sha256', $deliveryId)])
                ->connectTimeout(5)->timeout(15)->withOptions(['allow_redirects'=>false])
                ->post('https://api.resend.com/emails', $body);
        } catch (\Throwable $e) { throw new MailSendException('RESEND_NETWORK_UNKNOWN', false, true); }
        $status = $this->responseCode = $response->status();
        if ($status === 429) throw new MailSendException('RESEND_RATE_LIMITED', true, false, $status);
        if ($status >= 500) throw new MailSendException('RESEND_SERVER_UNKNOWN', false, true, $status);
        if (!$response->successful()) throw new MailSendException(match ($status) {
            401,403=>'RESEND_AUTH_REJECTED', 409=>'RESEND_IDEMPOTENCY_CONFLICT', default=>'RESEND_REQUEST_REJECTED',
        }, false, false, $status);
        $id = $response->json('id');
        if (!is_string($id) || !preg_match('/^[a-zA-Z0-9-]{1,255}$/D', $id)) throw new MailSendException('RESEND_RESPONSE_UNKNOWN', false, true, $status);
        return $id;
    }
}
