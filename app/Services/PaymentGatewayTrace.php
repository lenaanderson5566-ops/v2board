<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

final class PaymentGatewayTrace
{
    private const COLUMN = 'raw_diagnostic';
    private const BYTE_LIMIT = 1048576;
    private const SECTION_LIMIT = 128;
    private static ?self $current = null;

    private array $sections = [];
    private int $bytesLeft = self::BYTE_LIMIT;
    private int $exchanges = 0;
    private bool $truncated = false;
    private ?array $lastExchange = null;

    public function run(callable $operation): mixed
    {
        $previous = self::$current;
        self::$current = $this;
        try {
            return $operation();
        } finally {
            self::$current = $previous;
        }
    }

    public static function active(): bool
    {
        return self::$current !== null;
    }

    public static function recordExchange(array $exchange): void
    {
        if (!$trace = self::$current) return;
        if (!empty($exchange['truncated'])) $trace->truncated = true;
        $number = ++$trace->exchanges;
        $method = (string) ($exchange['method'] ?? '');
        $url = (string) ($exchange['url'] ?? '');
        $status = (int) ($exchange['status'] ?? 0);
        $trace->lastExchange = ['url' => $url, 'status' => $status];

        $trace->add("网关请求 #{$number}", trim($method . ' ' . $url));
        $trace->add("请求头 #{$number}", $exchange['request_headers'] ?? null);
        $trace->add("请求内容 #{$number}", $exchange['request_body'] ?? null);
        if ($status > 0) $trace->add("网关状态 #{$number}", 'HTTP ' . $status);
        $trace->add("响应头 #{$number}", $exchange['response_headers'] ?? null);
        $trace->add("响应内容 #{$number}", $exchange['response_body'] ?? null);
        $trace->add("通信错误 #{$number}", $exchange['error'] ?? null);
        $trace->add("采集说明 #{$number}", $exchange['notes'] ?? null);
    }

    public function lastExchange(): ?array
    {
        return $this->lastExchange;
    }

    public function add(string $title, mixed $value): void
    {
        if ($value === null) return;
        if ($this->bytesLeft <= 0 || count($this->sections) >= self::SECTION_LIMIT) {
            $this->truncated = true;
            return;
        }

        try {
            $text = is_string($value) ? $value : json_encode($value,
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
            $bytes = strlen($text);
            $isUtf8 = preg_match('//u', $text) === 1;
            if ($bytes > $this->bytesLeft) {
                $text = $isUtf8 ? mb_strcut($text, 0, $this->bytesLeft, 'UTF-8') : substr($text, 0, $this->bytesLeft);
                $this->bytesLeft = 0;
                $this->truncated = true;
                $title .= '（部分内容，原始 ' . $bytes . ' 字节）';
            } else {
                $this->bytesLeft -= $bytes;
            }
            if (!$isUtf8) {
                $title .= '（Base64）';
                $text = base64_encode($text);
            }
            $this->sections[] = ['title' => $title, 'text' => $text];
        } catch (\Throwable) {
            $this->truncated = true;
        }
    }

    public function storageFields(string $table): array
    {
        if (!$this->sections) return [];

        try {
            if (!Schema::hasColumn($table, self::COLUMN)) return [];
            $sections = $this->sections;
            if ($this->truncated) $sections[] = ['title' => '记录说明', 'text' => '诊断内容超过记录上限，或存在无法记录的内容。'];
            return [self::COLUMN => Crypt::encryptString(json_encode(['sections' => $sections],
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR))];
        } catch (\Throwable) {
            try {
                Log::warning('Payment diagnostic payload unavailable');
            } catch (\Throwable) {
                // Diagnostics must not interrupt payment or settlement.
            }
            return [];
        }
    }

    public static function selectAvailability(Builder $query, string $table, ?string $alias = null): Builder
    {
        if (!Schema::hasColumn($table, self::COLUMN)) return $query->selectRaw('0 AS has_raw_diagnostic');
        // Table and alias are fixed by the payment history queries.
        $column = $query->getGrammar()->wrap(($alias ?? $table) . '.' . self::COLUMN);
        return $query->selectRaw("CASE WHEN {$column} IS NULL THEN 0 ELSE 1 END AS has_raw_diagnostic");
    }

    public static function read(string $table, int $id): ?array
    {
        if (!Schema::hasColumn($table, self::COLUMN)) return null;
        $ciphertext = DB::table($table)->where('id', $id)->value(self::COLUMN);
        if ($ciphertext === null) return null;

        try {
            return json_decode(Crypt::decryptString($ciphertext), true, 16, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(500, '支付诊断原文暂时无法读取');
        }
    }
}
