<?php
namespace App\Services\Mail;

use App\Exceptions\MailgunSendException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;

class MailgunSender
{
    public ?int $responseCode = null;
    public function send(string $recipient, array $data): string
    {
        MailBlocklist::enforce($recipient);
        $domain = (string) config('v2board.email_mailgun_domain');
        $region = (string) config('v2board.email_mailgun_region', 'us');
        $from = (string) config('v2board.email_from_address');
        if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iD', $domain)
            || !in_array($region, ['us', 'eu'], true)
            || validator(['email'=>$from], ['email'=>'required|email:rfc'])->fails()) {
            throw new MailgunSendException('MAILGUN_CONFIG_INVALID');
        }
        try { $key = Crypt::decryptString((string) config('v2board.email_mailgun_api_key')); }
        catch (\Throwable $e) { throw new MailgunSendException('MAILGUN_KEY_INVALID'); }
        if ($key === '') throw new MailgunSendException('MAILGUN_KEY_INVALID');
        // Render before the network operation; never log message bodies or credentials.
        $fields = [
            'from' => (new \Symfony\Component\Mime\Address($from, $data['brand']))->toString(), 'to' => $recipient, 'subject' => $data['subject'],
            'html' => view('mail.product.message', $data)->render(),
            'text' => view('mail.product.text', $data)->render(),
            'o:tracking' => 'no', 'o:tracking-clicks' => 'no', 'o:tracking-opens' => 'no',
        ];
        if (!empty($data['unsubscribeUrl'])) { $fields['h:List-Unsubscribe']='<'.$data['unsubscribeUrl'].'>'; $fields['h:List-Unsubscribe-Post']='List-Unsubscribe=One-Click'; }
        $origin = $region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
        try {
            $response = Http::withBasicAuth('api', $key)->connectTimeout(5)->timeout(15)
                ->withOptions(['allow_redirects'=>false])->asMultipart()
                ->post($origin.'/v3/'.$domain.'/messages', $fields);
        } catch (\Throwable $e) {
            // A timeout can happen after acceptance. Do not automatically send a second copy.
            throw new MailgunSendException('MAILGUN_NETWORK_UNKNOWN', false, true);
        }
        $status = $this->responseCode = $response->status();
        if ($status === 429) throw new MailgunSendException('MAILGUN_RATE_LIMITED', true, false, $status);
        if ($status >= 500) throw new MailgunSendException('MAILGUN_SERVER_UNKNOWN', false, true, $status);
        if (!$response->successful()) {
            $code = match ($status) {
                401, 403 => 'MAILGUN_AUTH_REJECTED', 404 => 'MAILGUN_DOMAIN_NOT_FOUND',
                400, 422 => 'MAILGUN_REQUEST_REJECTED', default => 'MAILGUN_REQUEST_FAILED',
            };
            throw new MailgunSendException($code, false, false, $status);
        }
        $id = $response->json('id');
        if (!is_string($id) || strlen($id)>255 || !preg_match('/^[A-Za-z0-9@._<>+\-]+$/D', $id)) {
            throw new MailgunSendException('MAILGUN_RESPONSE_UNKNOWN', false, true, $status);
        }
        return $id;
    }
}
