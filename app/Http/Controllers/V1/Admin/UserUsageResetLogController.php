<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\EmailAddress;
use App\Services\UsageResetService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UserUsageResetLogController extends Controller
{
    public function index(Request $request)
    {
        $input = $request->validate([
            'user_id' => 'bail|sometimes|required|prohibits:email|integer|min:1',
            'email' => 'bail|sometimes|required|prohibits:user_id|string|max:254|email:rfc',
            'kind' => 'sometimes|required|in:use,grant,global',
            'from' => 'nullable|integer|min:0',
            'to' => 'nullable|integer|min:0',
            'current' => 'sometimes|integer|min:1|max:2147483647',
            'pageSize' => 'sometimes|integer|min:1|max:100',
        ]);
        if (isset($input['from'], $input['to']) && $input['from'] > $input['to']) {
            abort(422, '结束时间不能早于开始时间');
        }
        if (isset($input['email'])) {
            $input['user_id'] = EmailAddress::find($input['email'])?->id;
            abort_if($input['user_id'] === null, 404, '未找到匹配该邮箱的用户');
        }
        $kind = $input['kind'] ?? 'use';
        $logs = DB::table('v2_usage_reset_log as log')->where('log.kind', $kind);
        if (isset($input['user_id'])) {
            $logs->where('log.user_id', $input['user_id']);
        } elseif (!isset($input['from'])) {
            $input['to'] ??= time();
            $input['from'] = max(0, $input['to'] - 30 * 86400);
        }
        if (isset($input['from'])) $logs->where('log.created_at', '>=', $input['from']);
        if (isset($input['to'])) $logs->where('log.created_at', '<=', $input['to']);

        $total = $logs->count();
        $current = (int)($input['current'] ?? 1);
        $pageSize = (int)($input['pageSize'] ?? 10);
        if ($total === 0 || $current - 1 > intdiv($total - 1, $pageSize)) {
            return response()->json(['data' => [], 'total' => $total]);
        }

        $logs->select(['log.id', 'log.kind', 'log.quantity', 'log.batch_id', 'log.user_id', 'log.actor_id',
            'log.u_before', 'log.d_before', 'log.created_at']);
        if ($kind === 'grant') {
            $logs->leftJoin('v2_usage_reset_credit as credit', function ($join) {
                $join->on('credit.id', '=', 'log.credit_id')
                    ->on('credit.user_id', '=', 'log.user_id');
            })->addSelect(['credit.expires_at', 'credit.id as expiry_known']);
        }
        $rows = $logs->orderByDesc('log.created_at')->orderByDesc('log.id')->forPage($current, $pageSize)->get();
        $userIds = $rows->pluck('user_id')->merge($rows->pluck('actor_id'))->unique();
        $emails = DB::table('v2_user')->whereIn('id', $userIds)->pluck('email', 'id');
        foreach ($rows as $row) {
            $row->user_email = $emails->get($row->user_id);
            $row->actor_email = $emails->get($row->actor_id);
            $row->expiry_known = isset($row->expiry_known);
            $row->expires_at ??= null;
        }
        return response()->json(['data' => $rows, 'total' => $total]);
    }

    public function credits(Request $request, UsageResetService $service)
    {
        $input = $request->validate(['user_id' => 'required|integer|min:1']);
        $byExpiry = $service->available((int)$input['user_id'])
            ->select('expires_at')->selectRaw('SUM(remaining) AS remaining')
            ->groupBy('expires_at')->orderByRaw('expires_at IS NULL')->orderBy('expires_at')->get();
        $next = $byExpiry->first();
        $expiresAt = $next->expires_at ?? null;
        return response()->json(['data' => [
            'available' => (int)$byExpiry->sum('remaining'),
            'next_expires_at' => $expiresAt === null ? null : (int)$expiresAt,
            'next_expires_count' => $expiresAt === null ? 0 : (int)$next->remaining,
        ]]);
    }
}
