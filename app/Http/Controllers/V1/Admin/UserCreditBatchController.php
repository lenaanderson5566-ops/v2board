<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UserCreditBatchController extends Controller
{
    public function index(Request $request)
    {
        $input = $request->validate([
            'user_id' => 'required|integer|min:1',
            'current' => 'sometimes|integer|min:1|max:2147483647',
            'pageSize' => 'sometimes|integer|min:1|max:100',
            'status' => 'sometimes|in:active,used,expired',
        ]);
        $now = time();

        $result = DB::transaction(function () use ($input, $now) {
            $user = User::select('id', 'credit_balance')->findOrFail($input['user_id']);
            $batches = DB::table('v2_credit_batch as batch')->where('batch.user_id', $user->id);
            $active = (clone $batches)->where('batch.expires_at', '>', $now)->where('batch.remaining_bytes', '>', 0);
            $next = $active->orderBy('batch.expires_at')->orderBy('batch.id')->first();
            $expiredBytes = (clone $batches)->where('batch.expires_at', '<=', $now)->sum('batch.remaining_bytes');

            $matching = clone $batches;
            match ($input['status'] ?? null) {
                'active' => $matching->where('batch.expires_at', '>', $now)->where('batch.remaining_bytes', '>', 0),
                'used' => $matching->where('batch.expires_at', '>', $now)->where('batch.remaining_bytes', 0),
                'expired' => $matching->where('batch.expires_at', '<=', $now),
                default => null,
            };
            $total = $matching->count();
            $page = $matching->orderByRaw('CASE WHEN batch.expires_at > ? AND batch.remaining_bytes > 0 THEN 0 ELSE 1 END', [$now])
                ->orderBy('batch.expires_at')->orderBy('batch.id')
                ->forPage($input['current'] ?? 1, $input['pageSize'] ?? 10)
                ->get(['batch.id', 'batch.reference', 'batch.remaining_bytes', 'batch.expires_at', 'batch.created_at']);

            // Legacy installations can have different collations on the two reference columns.
            $grants = $page->isEmpty() ? collect() : DB::table('v2_traffic_credit_log')->where('user_id', $user->id)
                ->whereIn('reference', $page->pluck('reference'))->get(['reference', 'kind', 'bytes', 'snapshot'])->keyBy('reference');

            $orderIds = $page->mapWithKeys(fn ($batch) => preg_match('/\Aorder:([1-9][0-9]*)\z/', $batch->reference, $match)
                ? [$batch->id => (int)$match[1]] : []);
            $orders = $orderIds->isEmpty() ? collect() : Order::where('user_id', $user->id)
                ->whereIn('id', $orderIds->values())->get(['id', 'trade_no', 'credit_snapshot'])->keyBy('id');

            $data = $page->map(function ($batch) use ($now, $grants, $orders, $orderIds) {
                $grant = $grants->get($batch->reference);
                $order = $orders->get($orderIds->get($batch->id));
                $snapshot = json_decode($grant->snapshot ?? '', true);
                $name = $snapshot['name'] ?? $order?->credit_snapshot['name'] ?? null;
                $remaining = (int)$batch->remaining_bytes;
                $expired = (int)$batch->expires_at <= $now;
                return [
                    'id' => (int)$batch->id,
                    'reference' => $batch->reference,
                    'source' => $grant->kind ?? (str_starts_with($batch->reference, 'upgrade:') ? 'upgrade' : 'unknown'),
                    'granted_bytes' => $grant ? (int)$grant->bytes : null,
                    'remaining_bytes' => $remaining,
                    'available_bytes' => $expired ? 0 : $remaining,
                    'created_at' => (int)$batch->created_at,
                    'expires_at' => (int)$batch->expires_at,
                    'status' => $expired ? 'expired' : ($remaining === 0 ? 'used' : 'active'),
                    'order_id' => $order ? (int)$order->id : null,
                    'trade_no' => $order?->trade_no,
                    'plan_name' => is_string($name) && $name !== '' ? $name : null,
                ];
            });

            return ['data' => $data, 'total' => $total, 'meta' => ['summary' => [
                'available_bytes' => max(0, (int)$user->getRawOriginal('credit_balance') - (int)$expiredBytes),
                'next_expiry_at' => $next ? (int)$next->expires_at : null,
                'next_expiry_bytes' => $next ? (int)$next->remaining_bytes : null,
            ]]];
        });

        return response()->json($result)->header('Cache-Control', 'private, no-store');
    }
}
