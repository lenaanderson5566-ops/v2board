<?php
namespace App\Services\Mail;

use App\Exceptions\MailSendException;
use Aws\SesV2\SesV2Client;
use Aws\Exception\AwsException;
use Illuminate\Support\Facades\Crypt;

class SesSender
{
    public ?int $responseCode = null;
    protected function client(array $options): SesV2Client { return new SesV2Client($options); }

    public function send(string $recipient, array $data): string
    {
        MailBlocklist::enforce($recipient);
        $region = (string) config('v2board.email_ses_region', 'us-east-1');
        $from = (string) config('v2board.email_from_address');
        $mode = config('v2board.email_ses_auth', 'role');
        $set = (string) config('v2board.email_ses_configuration_set', '');
        if (!preg_match('/^(us|eu|ap|ca|sa|me|af|il|mx)-(?:[a-z]+-)?[a-z]+-[1-9]$/D', $region)
            || !in_array($mode, ['role','key'], true)
            || ($set !== '' && !preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $set))
            || validator(['email'=>$from], ['email'=>'required|email:rfc'])->fails()) throw new MailSendException('SES_CONFIG_INVALID');
        // Pin the AWS HTTPS endpoint. Disable SDK retries: acceptance may precede a lost response.
        $options = ['version'=>'2019-09-27', 'region'=>$region, 'endpoint'=>'https://email.'.$region.'.amazonaws.com',
            'retries'=>0, 'http'=>['connect_timeout'=>5, 'timeout'=>15, 'allow_redirects'=>false]];
        if ($mode === 'key') {
            try {
                $key = Crypt::decryptString((string) config('v2board.email_ses_access_key'));
                $secret = Crypt::decryptString((string) config('v2board.email_ses_secret_key'));
                if (!preg_match('/^AKIA[A-Z0-9]{16}$/D', $key) || $secret === '') throw new \RuntimeException();
                $options['credentials'] = ['key'=>$key, 'secret'=>$secret];
            } catch (\Throwable $e) { throw new MailSendException('SES_KEY_INVALID'); }
        }
        $request = ['FromEmailAddress'=>(new \Symfony\Component\Mime\Address($from, $data['brand']))->toString(),
            'Destination'=>['ToAddresses'=>[$recipient]], 'Content'=>['Simple'=>[
                'Subject'=>['Data'=>$data['subject'], 'Charset'=>'UTF-8'], 'Body'=>[
                    'Html'=>['Data'=>view('mail.product.message', $data)->render(), 'Charset'=>'UTF-8'],
                    'Text'=>['Data'=>view('mail.product.text', $data)->render(), 'Charset'=>'UTF-8']]]]];
        if (!empty($data['unsubscribeUrl'])) $request['Content']['Simple']['Headers']=[['Name'=>'List-Unsubscribe','Value'=>'<'.$data['unsubscribeUrl'].'>'],['Name'=>'List-Unsubscribe-Post','Value'=>'List-Unsubscribe=One-Click']];
        if ($set !== '') $request['ConfigurationSetName'] = $set;
        try { $result = $this->client($options)->sendEmail($request); }
        catch (\Aws\Exception\CredentialsException $e) { throw new MailSendException('SES_KEY_INVALID'); }
        catch (AwsException $e) {
            if ($e->getStatusCode() === 429 || $e->getAwsErrorCode() === 'TooManyRequestsException') throw new MailSendException('SES_RATE_LIMITED', true, false, $e->getStatusCode());
            if (!$e->getStatusCode() || $e->getStatusCode() >= 500) throw new MailSendException('SES_NETWORK_UNKNOWN', false, true, $e->getStatusCode());
            throw new MailSendException('SES_REQUEST_REJECTED', false, false, $e->getStatusCode());
        } catch (\Throwable $e) { throw new MailSendException('SES_NETWORK_UNKNOWN', false, true); }
        $this->responseCode = $result['@metadata']['statusCode'] ?? null;
        $id = $result['MessageId'];
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,255}$/D', $id)) throw new MailSendException('SES_RESPONSE_UNKNOWN', false, true, $this->responseCode);
        return $id;
    }
}
