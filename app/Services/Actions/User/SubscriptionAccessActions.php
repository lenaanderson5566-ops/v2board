<?php
namespace App\Services\Actions\User;

use App\Models\SubscribeLog;
use App\Services\ClientIdentity;
use App\Services\GeoIpService;
use App\Services\LogRetentionService;
use App\Services\SubscriptionClientRegistry;
use Illuminate\Http\Request;

final class SubscriptionAccessActions
{
    private const REASONS = ['banned', 'no_plan', 'expired', 'user_unavailable', 'client_disabled',
        'client_version_too_low', 'client_ua_not_allowed', 'client_format_not_allowed'];

    public function index(Request $request)
    {
        $page = max(1, (int) $request->input('page', 1));
        $size = min(100, max(1, (int) $request->input('pageSize', 20)));
        $days = app(LogRetentionService::class)->settings()['subscribe_log_retention_days'];
        $query = SubscribeLog::query()->where('user_id', (int) $request->attributes->get('v10.userId'));
        if ($days > 0) $query->where('created_at', '>=', time() - $days * 86400);
        $total = (clone $query)->count();
        $totalPages = (int) ceil($total / $size);
        $rows = $page > $totalPages ? collect() : $query->select(['id', 'created_at', 'client_type', 'status', 'reason', 'ip', 'country', 'region', 'city'])
            ->selectRaw('SUBSTR(user_agent, 1, 512) AS user_agent, LENGTH(user_agent) AS user_agent_length')
            ->orderByDesc('created_at')->orderByDesc('id')->forPage($page, $size)->get();
        return response()->json([
            'data' => $rows->map(fn($row) => $this->record($row))->all(),
            'meta' => ['pagination' => ['page' => $page, 'pageSize' => $size, 'total' => $total,
                'totalPages' => $totalPages], 'retentionDays' => $days > 0 ? $days : null],
        ]);
    }

    private function record(SubscribeLog $row): array
    {
        $status = $row->status === 'success' ? 'success'
            : (in_array($row->status, ['failed', 'unavailable'], true) ? 'failed' : 'unknown');
        $at = $row->getRawOriginal('created_at');
        [$name, $version] = $this->client($row);
        return [
            'id' => (int) $row->id,
            'requestedAt' => is_numeric($at) && $at > 0 && $at <= 253402300799 ? gmdate('Y-m-d\TH:i:s\Z', (int) $at) : null,
            'clientName' => $name,
            'clientVersion' => $version,
            'status' => $status,
            'reason' => $status === 'failed' && in_array($row->reason, self::REASONS, true) ? $row->reason : null,
            'ip' => GeoIpService::maskSessionIp(is_string($row->ip) ? $row->ip : null),
            'location' => $this->location($row),
        ];
    }

    private function client(SubscribeLog $row): array
    {
        $ua = $row->user_agent;
        if (($row->user_agent_length ?? 0) > 512 || ($ua !== null && (!is_string($ua)
            || preg_match('//u', $ua) !== 1 || preg_match('/[\x00-\x1f\x7f]|https?:\/\/|\b(?:bearer|token|password|authorization)\b/i', $ua)))) return [null, null];
        $type = is_string($row->client_type) ? SubscriptionClientRegistry::canonicalId($row->client_type) : null;
        if (is_string($ua) && trim($ua) !== '') $type = ClientIdentity::identify($ua);
        if ($type === null || !isset(SubscriptionClientRegistry::CLIENTS[$type])) return [null, null];
        $version = is_string($ua) ? ClientIdentity::version($type, $ua) : null;
        return [SubscriptionClientRegistry::CLIENTS[$type][2], $version !== null && strlen($version) <= 32 ? $version : null];
    }

    private function location(SubscribeLog $row): ?string
    {
        $parts = [];
        foreach ([$row->country, $row->region, $row->city] as $value) {
            if (!is_string($value)) continue;
            $value = trim($value);
            if ($value === '' || preg_match('/^[\p{L}\p{M}\p{N} .,\x{2019}\'()\-]{1,64}$/u', $value) !== 1
                || preg_match('/\b(?:bearer|token|secret|password|authorization)\b|[a-f0-9]{24,}|[a-z0-9_-]{40,}/i', $value)) continue;
            $parts[] = $value;
        }
        return $parts ? mb_substr(implode(' · ', array_unique($parts)), 0, 160) : null;
    }
}
