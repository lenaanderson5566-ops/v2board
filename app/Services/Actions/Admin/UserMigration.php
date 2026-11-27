<?php

namespace App\Services\Actions\Admin;

use App\Services\EmailAddress;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use JsonException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class UserMigration
{
    public const MAX_FILE_BYTES = 5 * 1024 * 1024;

    private const MAX_USERS = 10_000;
    private const MAX_BALANCE = 2_147_483_647;
    private const MIN_BCRYPT_COST = 10;
    private const MAX_BCRYPT_COST = 14;
    private const PREVIEW_SECONDS = 900;
    private const MIGRATIONS = 'v2_user_migration';
    private const BALANCE_FIELDS = ['wallet_balance', 'before_cutoff_credit', 'after_cutoff_credit'];
    private const MANIFEST_FIELDS = ['version', 'source_site', 'snapshot_at', 'cutoff_at', 'users'];
    private const ROW_FIELDS = [
        'source_user_id', 'email', 'password_hash', 'currency', 'wallet_balance',
        'before_cutoff_credit', 'after_cutoff_credit', 'review_reasons',
    ];
    private const REVIEW_REASONS = [
        'historical_entitlement_unverified', 'mixed_currency', 'wallet_balance_unverified',
        'payment_unverified', 'credentials_unusable', 'review_required',
        'pre_cutoff_entitlement_unknown', 'multi_currency_balance', 'unverified_post_cutoff_payment',
        'negative_source_balance', 'refund_reconciliation', 'wallet_deduction_reconciliation',
        'password_hash_cost_out_of_range', 'source_account_ineligible',
    ];

    public function preview(#[\SensitiveParameter] string $contents, int $administrator, string $session): array
    {
        $manifest = $this->parse($contents);
        $rows = $this->classify($manifest);
        $ready = [];
        foreach ($rows as $row) {
            if ($row['state'] === 'ready') $ready[] = $row['source_user_id'];
        }

        $token = bin2hex(random_bytes(32));
        $stored = Cache::put($this->previewKey($token), [
            'digest' => hash('sha256', $contents), 'administrator' => $administrator,
            'session' => $session, 'ready' => $ready,
        ], self::PREVIEW_SECONDS);
        abort_unless($stored, 503, '暂时无法保存迁移预览，请重试。');

        return $this->summary($manifest, $rows) + ['preview_token' => $token];
    }

    public function apply(
        #[\SensitiveParameter] string $contents,
        #[\SensitiveParameter] string $token,
        int $administrator,
        string $session,
        ?string $remarks = null
    ): array {
        $approved = $this->claimPreview($token, hash('sha256', $contents), $administrator, $session);
        $manifest = $this->parse($contents);
        $rows = $this->classify($manifest);
        $created = 0;
        $totals = ['CNY' => 0, 'USD' => 0];
        foreach ($rows as $row) {
            if ($row['state'] !== 'ready' || !isset($approved[$row['source_user_id']])) continue;
            if ($this->createUser($manifest, $row, $administrator, $remarks) !== 'ready') continue;

            $created++;
            $totals[$row['currency']] += $row['balance'];
        }

        return ['created' => $created, 'skipped' => count($rows) - $created, 'totals' => $totals];
    }

    private function claimPreview(#[\SensitiveParameter] string $token, string $digest, int $administrator, string $session): array
    {
        $key = $this->previewKey($token);
        $approved = Cache::lock($key.':claim', 10)->get(function () use ($key, $digest, $administrator, $session): ?array {
            $preview = Cache::get($key);
            if (!is_array($preview) || ($preview['administrator'] ?? null) !== $administrator
                || !hash_equals($preview['session'] ?? '', $session) || !hash_equals($preview['digest'], $digest)) {
                return null;
            }

            // Consume approval before writing. Retry an interrupted apply through a fresh preview.
            abort_unless(Cache::forget($key), 503, '暂时无法确认迁移预览，请重试。');
            return array_fill_keys($preview['ready'], true);
        });
        abort_unless(is_array($approved), 409, '迁移预览已失效，请使用同一份文件重新预览。');

        return $approved;
    }

    private function parse(#[\SensitiveParameter] string $contents): array
    {
        try {
            $manifest = json_decode($contents, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            abort(422, '迁移文件不是有效的 JSON。');
        }

        abort_unless(is_array($manifest) && self::hasFields($manifest, self::MANIFEST_FIELDS)
            && $manifest['version'] === 1
            && is_string($manifest['source_site']) && preg_match('/\A[a-z0-9][a-z0-9_-]{0,63}\z/', $manifest['source_site'])
            && is_int($manifest['snapshot_at']) && is_int($manifest['cutoff_at'])
            && $manifest['cutoff_at'] > 0 && $manifest['snapshot_at'] >= $manifest['cutoff_at']
            && is_array($manifest['users']) && array_is_list($manifest['users'])
            && count($manifest['users']) > 0 && count($manifest['users']) <= self::MAX_USERS,
            422, '迁移文件格式无效，或用户数量超出限制。');

        foreach ($manifest['users'] as $index => &$row) {
            $message = '迁移文件第 '.($index + 1).' 条用户记录格式无效。';
            abort_unless(is_array($row) && self::hasFields($row, self::ROW_FIELDS)
                && is_int($row['source_user_id']) && $row['source_user_id'] > 0
                && is_string($row['email']) && strlen($row['email']) <= 256
                && is_string($row['password_hash']) && preg_match('/\A\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[.\/0-9A-Za-z]{53}\z/', $row['password_hash'], $hashParts)
                && in_array($row['currency'], ['CNY', 'USD'], true)
                && is_array($row['review_reasons']) && array_is_list($row['review_reasons']) && count($row['review_reasons']) <= 12,
                422, $message);

            $row['email'] = EmailAddress::key($row['email']);
            abort_unless(mb_strlen($row['email']) <= 64 && filter_var($row['email'], FILTER_VALIDATE_EMAIL, FILTER_FLAG_EMAIL_UNICODE), 422, $message);
            $balance = 0;
            foreach (self::BALANCE_FIELDS as $field) {
                $amount = $row[$field];
                abort_unless(is_int($amount) && $amount >= 0 && $amount <= self::MAX_BALANCE - $balance, 422, $message);
                $balance += $amount;
            }
            $row['balance'] = $balance;

            foreach ($row['review_reasons'] as &$reason) {
                abort_unless(is_string($reason) && preg_match('/\A[a-z][a-z0-9_]{0,63}\z/', $reason), 422, $message);
                if (!in_array($reason, self::REVIEW_REASONS, true)) $reason = 'review_required';
            }
            unset($reason);
            $cost = (int)$hashParts[1];
            if ($cost < self::MIN_BCRYPT_COST || $cost > self::MAX_BCRYPT_COST) {
                $row['review_reasons'][] = 'password_hash_cost_out_of_range';
            }
            if (str_ends_with($row['email'], '@deleted.invalid')) {
                $row['review_reasons'][] = 'source_account_ineligible';
            }
            $row['review_reasons'] = array_values(array_unique($row['review_reasons']));
        }
        unset($row);

        abort_unless(Schema::hasTable(self::MIGRATIONS), 503, '请先升级数据库再使用用户迁移。');
        return $manifest;
    }

    private static function hasFields(array $record, array $fields): bool
    {
        return count($record) === count($fields) && !array_diff($fields, array_keys($record));
    }

    private function classify(#[\SensitiveParameter] array $manifest): array
    {
        $rows = $manifest['users'];
        $sourceCounts = array_count_values(array_column($rows, 'source_user_id'));
        $emailCounts = array_count_values(array_column($rows, 'email'));
        // Index matching normalized keys even when a legacy destination email is not canonical.
        $targetCounts = [];
        foreach (DB::table('v2_user')->select('id', 'email')->lazyById(1000) as $existing) {
            $key = $this->existingEmailKey($existing->email);
            if ($key !== null && isset($emailCounts[$key])) $targetCounts[$key] = ($targetCounts[$key] ?? 0) + 1;
        }
        $imported = [];
        foreach (array_chunk(array_keys($sourceCounts), 500) as $ids) {
            $previous = DB::table(self::MIGRATIONS)->where('source_site', $manifest['source_site'])
                ->whereIn('source_user_id', $ids)->pluck('source_user_id');
            foreach ($previous as $id) $imported[$id] = true;
        }

        foreach ($rows as &$row) {
            $source = $row['source_user_id'];
            $email = $row['email'];
            $matches = $targetCounts[$email] ?? 0;
            $reason = match (true) {
                $sourceCounts[$source] > 1 => 'duplicate_source_user',
                $emailCounts[$email] > 1 => 'duplicate_file_email',
                $matches > 1 => 'ambiguous_target_email',
                default => null,
            };
            $row['state'] = match (true) {
                $reason !== null => 'conflict',
                isset($imported[$source]) => 'already_imported',
                $matches === 1 => 'existing_email',
                (bool)$row['review_reasons'] => 'needs_review',
                default => 'ready',
            };
            if ($reason !== null) $row['review_reasons'] = [$reason];
        }
        unset($row);

        return $rows;
    }

    private function createUser(
        #[\SensitiveParameter] array $manifest,
        #[\SensitiveParameter] array $row,
        int $administrator,
        ?string $remarks
    ): string {
        try {
            return DB::transaction(function () use ($manifest, $row, $administrator, $remarks) {
                if ($this->alreadyImported($manifest, $row)) return 'already_imported';
                $state = $this->storedEmailState($row['email']);
                if ($state !== 'ready') return $state;

                $now = time();
                // Explicit import currency bypasses the new-registration default currency.
                $id = DB::table('v2_user')->insertGetId([
                    'email' => $row['email'], 'password' => $row['password_hash'],
                    'currency' => $row['currency'], 'balance' => $row['balance'],
                    'remarks' => $remarks,
                    'is_admin' => 0, 'banned' => 0, 'uuid' => (string)Str::uuid(),
                    'token' => bin2hex(random_bytes(16)), 'created_at' => $now, 'updated_at' => $now,
                ]);
                DB::table(self::MIGRATIONS)->insert([
                    'source_site' => $manifest['source_site'], 'source_user_id' => $row['source_user_id'],
                    'user_id' => $id, 'administrator_id' => $administrator, 'currency' => $row['currency'],
                    'wallet_balance' => $row['wallet_balance'], 'before_cutoff_credit' => $row['before_cutoff_credit'],
                    'after_cutoff_credit' => $row['after_cutoff_credit'], 'cutoff_at' => $manifest['cutoff_at'],
                    'snapshot_at' => $manifest['snapshot_at'], 'created_at' => $now,
                ]);
                return 'ready';
            }, 3);
        } catch (UniqueConstraintViolationException) {
            // A competing registration or migration can win after preview. The failed insert is rolled back.
            if ($this->alreadyImported($manifest, $row)) return 'already_imported';
            $state = $this->storedEmailState($row['email']);
            if ($state !== 'ready') return $state;
            abort(409, '检测到迁移冲突，请重新预览后重试。');
        } catch (QueryException) {
            // SQL exception messages may contain the password hash from the failed insert.
            abort(503, '暂时无法写入迁移记录，请重新预览后重试。');
        }
    }

    private function alreadyImported(#[\SensitiveParameter] array $manifest, #[\SensitiveParameter] array $row): bool
    {
        return DB::table(self::MIGRATIONS)->where('source_site', $manifest['source_site'])
            ->where('source_user_id', $row['source_user_id'])->exists();
    }

    private function storedEmailState(string $email): string
    {
        $separator = strrpos($email, '@');
        $domain = idn_to_utf8(substr($email, $separator + 1), IDNA_NONTRANSITIONAL_TO_UNICODE, INTL_IDNA_VARIANT_UTS46);
        $variants = array_unique([$email, substr($email, 0, $separator + 1).$domain]);
        $matches = DB::table('v2_user')->whereIn('email', $variants)->pluck('email');
        if ($matches->isEmpty()) return 'ready';
        if ($matches->count() === 1 && $this->existingEmailKey($matches->first()) === $email) return 'existing_email';
        return 'conflict';
    }

    private function existingEmailKey(string $email): ?string
    {
        try {
            return EmailAddress::key($email);
        } catch (HttpExceptionInterface) {
            return null;
        }
    }

    private function summary(#[\SensitiveParameter] array $manifest, #[\SensitiveParameter] array $rows): array
    {
        $counts = array_count_values(array_column($rows, 'state'));
        $totals = ['CNY' => 0, 'USD' => 0];
        foreach ($rows as $row) {
            if ($row['state'] === 'ready') $totals[$row['currency']] += $row['balance'];
        }

        $attention = array_filter($rows, static fn (array $row): bool => in_array($row['state'], ['conflict', 'needs_review'], true));
        // Report blocked rows first so an ordered input file cannot hide all review examples.
        $sample = array_slice($attention + $rows, 0, 50);

        return [
            'source_site' => $manifest['source_site'], 'snapshot_at' => $manifest['snapshot_at'],
            'cutoff_at' => $manifest['cutoff_at'], 'total' => count($rows), 'ready' => $counts['ready'] ?? 0,
            'existing_email' => $counts['existing_email'] ?? 0, 'already_imported' => $counts['already_imported'] ?? 0,
            'needs_review' => $counts['needs_review'] ?? 0, 'conflicts' => $counts['conflict'] ?? 0,
            'totals' => $totals,
            'rows' => array_map(static fn (array $row): array => [
                'source_user_id' => $row['source_user_id'], 'email' => $row['email'], 'currency' => $row['currency'],
                'balance' => $row['balance'], 'state' => $row['state'], 'review_reasons' => $row['review_reasons'],
            ], $sample),
        ];
    }

    private function previewKey(#[\SensitiveParameter] string $token): string
    {
        return 'admin:user-migration:preview:'.hash('sha256', $token);
    }
}
