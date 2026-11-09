<?php

namespace App\Services;

use Curl\Curl;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Promise\Create;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamInterface;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Stripe\HttpClient\CurlClient;
use Stripe\Util\Util;

final class PaymentGatewayTransport
{
    private const COPY_LIMIT = 1048576;

    public static function post(object $curl, string $url, string $body): mixed
    {
        if (!PaymentGatewayTrace::active()) return $curl->post($url, $body);

        $error = null;
        try {
            return $curl->post($url, $body);
        } catch (\Throwable $exception) {
            $error = $exception->getMessage();
            throw $exception;
        } finally {
            self::record([
                'method' => 'POST',
                'url' => $url,
                'request_headers' => self::curlRequestHeaders($curl),
                'request_body' => $body,
                'status' => $curl->httpStatusCode ?? null,
                'response_headers' => $curl->rawResponseHeaders ?? null,
                'response_body' => $curl->rawResponse ?? $curl->response ?? null,
                'error' => $error ?? ($curl->errorMessage ?? null),
            ]);
        }
    }

    private static function curlRequestHeaders(object $curl): mixed
    {
        try {
            return $curl instanceof Curl
                ? ($curl->getInfo(CURLINFO_HEADER_OUT) ?: $curl->getOpt(CURLOPT_HTTPHEADER))
                : ($curl->requestHeaders ?? null);
        } catch (\Throwable) {
            return null;
        }
    }

    public static function executeCurl(\CurlHandle $handle, string $url, array $headers, string|false $body): string|false
    {
        if (!PaymentGatewayTrace::active()) return curl_exec($handle);

        $responseHeaders = '';
        $headersTruncated = false;
        curl_setopt($handle, CURLINFO_HEADER_OUT, true);
        curl_setopt($handle, CURLOPT_HEADERFUNCTION,
            static function (\CurlHandle $handle, string $line) use (&$responseHeaders, &$headersTruncated): int {
                $bytes = strlen($line);
                $available = self::COPY_LIMIT - strlen($responseHeaders);
                if ($bytes > $available) $headersTruncated = true;
                if ($available > 0) $responseHeaders .= substr($line, 0, $available);
                return $bytes;
            });
        $response = curl_exec($handle);
        self::record([
            'method' => 'POST',
            'url' => $url,
            'request_headers' => curl_getinfo($handle, CURLINFO_HEADER_OUT) ?: $headers,
            'request_body' => $body,
            'status' => curl_getinfo($handle, CURLINFO_HTTP_CODE),
            'response_headers' => $responseHeaders,
            'response_body' => $response === false ? null : $response,
            'error' => curl_error($handle) ?: null,
            'truncated' => $headersTruncated,
        ]);
        return $response;
    }

    public static function guzzle(): Client
    {
        if (!PaymentGatewayTrace::active()) return new Client();

        $stack = HandlerStack::create();
        $stack->push(self::middleware());
        return new Client(['handler' => $stack]);
    }

    public static function middleware(): callable
    {
        return static function (callable $handler): callable {
            return static function (RequestInterface $request, array $options) use ($handler) {
                if (!PaymentGatewayTrace::active()) return $handler($request, $options);

                $body = self::readStream($request->getBody(), $truncated);
                $exchange = [
                    'method' => $request->getMethod(),
                    'url' => (string) $request->getUri(),
                    'request_headers' => $request->getHeaders(),
                    'request_body' => $body,
                    'truncated' => $truncated,
                ];
                if ($body === null) $exchange['notes'] = '请求内容由不可重读的流传输。';
                try {
                    return $handler($request, $options)->then(
                        static function (ResponseInterface $response) use ($exchange) {
                            self::recordResponse($exchange, $response);
                            return $response;
                        },
                        static function (mixed $error) use ($exchange) {
                            self::recordFailure($exchange, $error);
                            return Create::rejectionFor($error);
                        },
                    );
                } catch (\Throwable $error) {
                    self::recordFailure($exchange, $error);
                    throw $error;
                }
            };
        };
    }

    private static function recordFailure(array $exchange, mixed $error): void
    {
        $exchange['error'] = $error instanceof \Throwable ? $error->getMessage() : null;
        if ($error instanceof RequestException && $error->hasResponse()) {
            self::recordResponse($exchange, $error->getResponse());
        } else {
            self::record($exchange);
        }
    }

    public static function withStripe(callable $operation): mixed
    {
        if (!PaymentGatewayTrace::active()) return $operation();

        try {
            // Stripe v14 exposes a setter only. Preserve a custom client and restore it after this payment.
            $existing = (new \ReflectionProperty(ApiRequestor::class, '_httpClient'))->getValue();
            $client = new class($existing ?? CurlClient::instance()) implements ClientInterface {
                public function __construct(private readonly ClientInterface $client) {}

                public function request($method, $absUrl, $headers, $params, $hasFile)
                {
                    $exchange = ['method' => $method, 'url' => $absUrl, 'request_headers' => $headers];
                    try {
                        if ($hasFile) {
                            $exchange['notes'] = 'SDK 未提供完整的 multipart 请求原文。';
                        } else {
                            $encoded = Util::encodeParameters(Util::objectsToIds($params));
                            if ($method === 'post') $exchange['request_body'] = $encoded;
                            elseif ($encoded !== '') $exchange['url'] .= '?' . $encoded;
                        }
                    } catch (\Throwable) {
                        $exchange['notes'] = 'SDK 请求参数无法转换为原始内容。';
                    }

                    try {
                        $response = $this->client->request($method, $absUrl, $headers, $params, $hasFile);
                    } catch (\Throwable $error) {
                        PaymentGatewayTransport::record($exchange + ['error' => $error->getMessage()]);
                        throw $error;
                    }
                    PaymentGatewayTransport::record($exchange + [
                        'status' => $response[1] ?? null,
                        'response_headers' => $response[2] ?? null,
                        'response_body' => $response[0] ?? null,
                    ]);
                    return $response;
                }
            };
            ApiRequestor::setHttpClient($client);
        } catch (\Throwable) {
            return $operation();
        }

        try {
            return $operation();
        } finally {
            ApiRequestor::setHttpClient($existing);
        }
    }

    public static function omnipayClient(): ?object
    {
        // Some installations provide this optional SDK outside the base Composer dependencies.
        if (!PaymentGatewayTrace::active() || !interface_exists(\Omnipay\Common\Http\ClientInterface::class)
            || !class_exists(\Omnipay\Common\Http\Client::class)) return null;

        try {
            // Optional older SDKs can expose a different HTTP contract. In that case keep SDK defaults.
            $interface = new \ReflectionClass(\Omnipay\Common\Http\ClientInterface::class);
            if (count($interface->getMethods()) !== 1) return null;
            $method = $interface->getMethod('request');
            if ($method->getNumberOfParameters() !== 5 || $method->getNumberOfRequiredParameters() < 2
                || $method->returnsReference() || $method->isStatic() || $method->isVariadic()) return null;
            foreach ($method->getParameters() as $parameter) {
                if ($parameter->isPassedByReference()) return null;
            }
            $returnType = $method->getReturnType();
            if ($returnType !== null && (!$returnType instanceof \ReflectionNamedType || !in_array($returnType->getName(),
                [ResponseInterface::class, 'object', 'mixed'], true))) return null;
            $client = new \Omnipay\Common\Http\Client();
        } catch (\Throwable) {
            return null;
        }

        return new class($client) implements \Omnipay\Common\Http\ClientInterface {
            public function __construct(private readonly \Omnipay\Common\Http\ClientInterface $client) {}

            public function request($method, $uri, $headers = [], $body = null, $protocolVersion = '1.1'): ResponseInterface
            {
                $truncated = false;
                $content = $body instanceof StreamInterface ? PaymentGatewayTransport::readStream($body, $truncated) : $body;
                $exchange = [
                    'method' => $method,
                    'url' => (string) $uri,
                    'request_headers' => $headers,
                    'request_body' => $content,
                    'truncated' => $truncated,
                ];
                if ($body !== null && $content === null) $exchange['notes'] = '请求内容由不可重读的流传输。';
                try {
                    $response = $this->client->request($method, $uri, $headers, $body, $protocolVersion);
                    PaymentGatewayTransport::recordResponse($exchange, $response);
                    return $response;
                } catch (\Throwable $error) {
                    PaymentGatewayTransport::record($exchange + ['error' => $error->getMessage()]);
                    throw $error;
                }
            }
        };
    }

    /** @internal Used by transport decorators. */
    public static function recordResponse(array $exchange, ResponseInterface $response): void
    {
        $body = self::readStream($response->getBody(), $truncated);
        if ($truncated) $exchange['truncated'] = true;
        if ($body === null) $exchange['notes'] = ($exchange['notes'] ?? '') . '响应内容由不可重读的流传输。';
        self::record($exchange + [
            'status' => $response->getStatusCode(),
            'response_headers' => $response->getHeaders(),
            'response_body' => $body,
        ]);
    }

    /** @internal Used by transport decorators. */
    public static function readStream(StreamInterface $stream, ?bool &$truncated = null): ?string
    {
        $truncated = false;
        try {
            if (!$stream->isSeekable() || !$stream->isReadable()) return null;
            $position = $stream->tell();
            $stream->rewind();
            try {
                $content = '';
                while (($remaining = self::COPY_LIMIT + 1 - strlen($content)) > 0 && !$stream->eof()) {
                    $chunk = $stream->read($remaining);
                    if ($chunk === '') break;
                    $content .= $chunk;
                }
                $truncated = strlen($content) > self::COPY_LIMIT;
                return $truncated ? substr($content, 0, self::COPY_LIMIT) : $content;
            } finally {
                $stream->seek($position);
            }
        } catch (\Throwable) {
            return null;
        }
    }

    /** @internal Used by transport decorators. */
    public static function record(array $exchange): void
    {
        try {
            PaymentGatewayTrace::recordExchange($exchange);
        } catch (\Throwable) {
            // A diagnostic must never interfere with the provider exchange.
        }
    }
}
