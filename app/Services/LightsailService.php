<?php

namespace App\Services;

use Aws\Lightsail\LightsailClient;
use Aws\Exception\AwsException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Cache;
class LightsailService
{
    private static function awsFailure(AwsException $error): string
    {
        $operations = ['GetInstance'=>'instance', 'GetStaticIps'=>'list', 'GetStaticIp'=>'get', 'AllocateStaticIp'=>'allocate', 'AttachStaticIp'=>'attach', 'DetachStaticIp'=>'detach', 'ReleaseStaticIp'=>'release'];
        $operation = $operations[$error->getCommand()->getName()] ?? 'request';
        $known = ['AccessDenied','AccessDeniedException','UnauthorizedException','UnauthorizedOperation','UnauthenticatedException','InvalidClientTokenId','UnrecognizedClientException','SignatureDoesNotMatch','InvalidSignatureException','ExpiredToken','ExpiredTokenException','RequestExpired','RequestTimeTooSkewed','Throttling','ThrottlingException','TooManyRequestsException','RequestLimitExceeded','ServiceQuotaExceededException','LimitExceededException','ResourceLimitExceededException','InvalidInputException','NotFoundException','OperationFailureException','ServiceException','InternalError','InternalFailure','ServiceUnavailableException','AccountSetupInProgressException','RegionSetupInProgressException'];
        $known = array_merge($known, ['MissingAuthenticationTokenException','IncompleteSignature','IncompleteSignatureException','InvalidAccessKeyId','AuthFailure','RequestTimeout','RequestTimeoutException','ValidationException','OptInRequired']);
        $provider = $error->isConnectionError() ? 'NetworkError' : (in_array($error->getAwsErrorCode(),$known,true) ? $error->getAwsErrorCode() : 'UnknownError');
        $previous = $error->getPrevious();
        $context = $previous instanceof \GuzzleHttp\Exception\RequestException || $previous instanceof \GuzzleHttp\Exception\ConnectException ? $previous->getHandlerContext() : [];
        // Keep only numeric transport diagnostics; exception text and bodies can contain secrets.
        $curl = (int)($context['errno'] ?? 0);
        if (in_array($curl, [5,6,7,28,35,51,60,77], true)) $provider = 'Curl'.$curl;
        if ($provider === 'UnknownError' && ($status = $error->getStatusCode()) >= 400 && $status <= 599) $provider = 'Http'.$status;
        // Never persist provider messages: they may include signed URLs or credentials.
        $quota = $operation === 'allocate' && in_array($provider,['InvalidInputException','OperationFailureException'],true)
            && preg_match('/quota|limit\s+exceeded|maximum\s+number|too\s+many|exceeds?.*limit/i',(string)$error->getAwsErrorMessage());
        return 'aws:'.$operation.':'.$provider.($quota ? ':quota' : '');
    }
    public static function operationLock($row)
    {
        return Cache::lock('lightsail:' . hash('sha256', $row->region . ':' . $row->instance), 300);
    }
    public function client($row): LightsailClient
    {
        $credential = DB::table('v2_lightsail_credential')->find($row->credential_id);
        if (!$credential) throw new \RuntimeException('credential_missing');
        return new LightsailClient(['version' => 'latest', 'region' => $row->region, 'credentials' => json_decode(Crypt::decryptString($credential->credentials), true, 512, JSON_THROW_ON_ERROR), 'http' => ['connect_timeout' => 5, 'timeout' => 15], 'retries' => 0]);
    }
    public function staticIp($client, string $name): ?array
    {
        try {
            return $client->getStaticIp(['staticIpName' => $name])['staticIp'];
        } catch (AwsException $e) {
            if ($e->getAwsErrorCode() === 'NotFoundException') {
                return null;
            }
            // Lightsail also uses HTTP 400 for missing resources. If the SDK
            // cannot identify the error, reconcile through an independent read;
            // never infer absence from the HTTP status or provider message.
            if (!$e->getAwsErrorCode() && $e->getStatusCode() === 400) {
                $token = null;
                $seen = [];
                do {
                    $page = $client->getStaticIps($token === null ? [] : ['pageToken' => $token]);
                    if (!is_array($page['staticIps'])) throw $e;
                    foreach ($page['staticIps'] as $ip) {
                        if (($ip['name'] ?? null) === $name) return $ip;
                    }
                    $token = $page['nextPageToken'] ?? null;
                    if ($token !== null && $token !== '') {
                        if (!is_string($token) || isset($seen[$token])) throw $e;
                        $seen[$token] = true;
                    }
                } while ($token !== null && $token !== '');
                return null;
            }
            throw $e;
        }
    }
    public function wait($client, string $name, ?string $instance): array
    {
        for ($i = 0; $i < 20; $i++) {
            $ip = $this->staticIp($client, $name);
            if ($ip && ($instance === null ? !($ip['isAttached'] ?? false) : (($ip['isAttached'] ?? false) && ($ip['attachedTo'] ?? null) === $instance))) {
                return $ip;
            }
            sleep(1);
        }
        throw new \RuntimeException('operation_pending');
    }
    public function waitGone($client, string $name): void
    {
        for ($i = 0; $i < 20; $i++) {
            if (!$this->staticIp($client, $name)) {
                return;
            }
            sleep(1);
        }
        throw new \RuntimeException('operation_pending');
    }
    public function run(int $id): void
    {
        $row = DB::table('v2_lightsail_server')->find($id);
        if (!$row) {
            return;
        }
        $lock = self::operationLock($row);
        if (!$lock->get()) {
            throw new \RuntimeException('instance_busy');
        }
        try {
            $row = DB::table('v2_lightsail_server')->find($id);
            if (!$row || !in_array($row->status, ['queued', 'running'], true)) {
                return;
            }
            $node = (new ServerService())->getServer($row->node_id, $row->node_type);
            if (!$node || $node->service_id) {
                throw new \RuntimeException("node_missing");
            }
            $client = $this->client($row);
            $update = function (array $values) use ($id, $row) {
                DB::table('v2_lightsail_server')->where('id', $id)->update($values);
                foreach ($values as $k => $v) {
                    $row->{$k} = $v;
                }
            };
            $update(['status' => 'running', 'error_code' => null, 'operation_at' => time()]);
            if ($row->operation === 'rotate' && !in_array($row->phase, ['idle', 'allocate', 'attach', 'publish', 'release', 'complete'], true)) throw new \RuntimeException('invalid_operation_state');
            if ($row->operation === 'restore') {
                $old = $row->old_name ? $this->staticIp($client, $row->old_name) : null;
                if (!$old) {
                    throw new \RuntimeException('old_ip_unavailable');
                }
                if (($old['isAttached'] ?? false) && ($old['attachedTo'] ?? null) !== $row->instance) {
                    throw new \RuntimeException('old_ip_in_use');
                }
                if (($old['attachedTo'] ?? null) !== $row->instance) {
                    $new = $row->new_name ? $this->staticIp($client, $row->new_name) : null;
                    if (($new['attachedTo'] ?? null) === $row->instance) {
                        $client->detachStaticIp(['staticIpName' => $row->new_name]);
                        $this->wait($client, $row->new_name, null);
                    }
                    $client->attachStaticIp(['staticIpName' => $row->old_name, 'instanceName' => $row->instance]);
                }
                $ip = $this->wait($client, $row->old_name, $row->instance);
                $update(['current_ip' => $ip['ipAddress'], 'phase' => 'restored']);
                $this->publish($row, $ip['ipAddress']);
                $new = $row->new_name ? $this->staticIp($client, $row->new_name) : null;
                if ($new && !($new['isAttached'] ?? false)) {
                    $client->releaseStaticIp(['staticIpName' => $row->new_name]);
                    $this->waitGone($client, $row->new_name);
                }
                $update(['status' => 'restored']);
                return;
            }
            if ($row->phase === 'idle') {
                $ddns = DB::table('v2_node_ddns')->where('node_type', $row->node_type)->where('node_id', $row->node_id)->where('enabled', 1)->first();
                if ($ddns) {
                    if ($ddns->family === 'ipv6') {
                        throw new \RuntimeException('ddns_requires_ipv4');
                    }
                    $credential = DB::table('v2_ddns_credential')->find($ddns->credential_id);
                    if (!$credential || $credential->next_run < 0 || $credential->next_run > time()) {
                        throw new \RuntimeException('dns_not_ready');
                    }
                }
                $instance = $client->getInstance(['instanceName' => $row->instance])['instance'];
                if (!($instance['isStaticIp'] ?? false)) {
                    throw new \RuntimeException('static_ip_required');
                }
                $old = null;
                $token = null;
                do {
                    $page = $client->getStaticIps($token ? ['pageToken' => $token] : []);
                    $old = collect($page['staticIps'])->first(fn($ip) => ($ip['attachedTo'] ?? null) === $row->instance);
                    $token = $page['nextPageToken'] ?? null;
                } while (!$old && $token);
                if (!$old) {
                    throw new \RuntimeException('static_ip_not_found');
                }
                $update(['old_name' => $old['name'], 'current_ip' => $old['ipAddress'], 'phase' => 'allocate']);
            }
            if ($row->phase === 'allocate') {
                if (!$this->staticIp($client, $row->new_name)) {
                    $client->allocateStaticIp(['staticIpName' => $row->new_name]);
                }
                $this->wait($client, $row->new_name, null);
                $update(['phase' => 'attach']);
            }
            if ($row->phase === 'attach') {
                $new = $this->staticIp($client, $row->new_name);
                if (!$new) {
                    throw new \RuntimeException('new_ip_missing');
                }
                if (($new['isAttached'] ?? false) && ($new['attachedTo'] ?? null) !== $row->instance) {
                    throw new \RuntimeException('new_ip_in_use');
                }
                if (($new['attachedTo'] ?? null) !== $row->instance) {
                    $old = $this->staticIp($client, $row->old_name);
                    if (($old['attachedTo'] ?? null) === $row->instance) {
                        $client->detachStaticIp(['staticIpName' => $row->old_name]);
                        $this->wait($client, $row->old_name, null);
                    }
                    $client->attachStaticIp(['staticIpName' => $row->new_name, 'instanceName' => $row->instance]);
                }
                $ip = $this->wait($client, $row->new_name, $row->instance);
                $update(['current_ip' => $ip['ipAddress'], 'phase' => 'publish']);
            }
            if ($row->phase === 'publish') {
                $this->publish($row, $row->current_ip);
                $update(['phase' => 'release']);
            }
            if ($row->phase === 'release') {
                $new = $this->wait($client, $row->new_name, $row->instance);
                $old = $this->staticIp($client, $row->old_name);
                if ($old) {
                    if ($old['isAttached'] ?? false) {
                        throw new \RuntimeException('old_ip_in_use');
                    }
                    $client->releaseStaticIp(['staticIpName' => $row->old_name]);
                    $this->waitGone($client, $row->old_name);
                }
                $update(['phase' => 'complete', 'status' => 'completed']);
            }
        } catch (\Throwable $e) {
            $code = $e instanceof AwsException ? self::awsFailure($e) : (in_array($e->getMessage(), ['operation_pending', 'old_ip_unavailable', 'static_ip_required', 'static_ip_not_found', 'new_ip_missing', 'old_ip_in_use', 'new_ip_in_use', 'node_missing', 'credential_missing', 'invalid_operation_state', 'ddns_requires_ipv4', 'dns_update_failed', 'dns_not_ready'], true) ? $e->getMessage() : 'operation_failed');
            $failure = ['status' => 'failed', 'error_code' => $code];
            if ($code === 'old_ip_unavailable' && ($row->operation ?? null) === 'restore' && $row->phase !== 'restored') {
                $failure['operation'] = 'rotate';
            }
            DB::table('v2_lightsail_server')->where('id', $id)->update($failure);
        } finally {
            $lock->release();
        }
    }
    private function publish($row, string $ip): void
    {
        Cache::put('NODE_CURRENT_IP:' . $row->node_type . ':' . $row->node_id, $ip, 86400);
        $assignment = DB::table('v2_node_ddns')->where('node_type', $row->node_type)->where('node_id', $row->node_id)->where('enabled', 1)->first();
        if ($assignment) {
            if ($assignment->family === 'ipv6') {
                throw new \RuntimeException('ddns_requires_ipv4');
            }
            DB::table('v2_node_ddns')->where('id', $assignment->id)->update(['ipv4' => $ip, 'ipv4_seen_at' => time(), 'next_run' => 0, 'status' => 'awaiting_report']);
            (new NodeDdnsService())->sync($assignment->id);
            $verified = DB::table('v2_node_ddns')->find($assignment->id);
            if (!$verified || $verified->status !== 'healthy' || $verified->ipv4 !== $ip) {
                throw new \RuntimeException('dns_update_failed');
            }
        }
    }
}
