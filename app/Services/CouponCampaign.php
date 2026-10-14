<?php

namespace App\Services;

use App\Models\Coupon;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class CouponCampaign
{
    private static function terms(Coupon $coupon): array
    {
        return $coupon->only(['name','value','started_at','ended_at','limit_plan_ids','limit_period','translations','activity_title','activity_description']);
    }

    private static function hash(Coupon $coupon): string
    {
        return hash('sha256', json_encode([self::terms($coupon), (int)$coupon->show, (int)$coupon->type], JSON_THROW_ON_ERROR));
    }

    private static function validateCoupon(Coupon $coupon): void
    {
        abort_unless($coupon->show && (int)$coupon->type === 2 && $coupon->value > 0 && $coupon->value <= 100
            && $coupon->started_at <= time() && $coupon->ended_at > time(), 409, '优惠券未启用、未生效或已过期。');
    }

    public static function preview(Request $request): array
    {
        $input = $request->validate(['coupon_id'=>'required|integer|min:1','scope'=>'required|in:all,filtered,ids',
            'user_ids'=>'nullable|array|min:1|max:100','user_ids.*'=>'required|integer|min:1|distinct|exists:v2_user,id']);
        $query = User::query();
        AdminUserFilters::apply($request, $query);
        $filters = $request->input('filter', []) ?: [];
        abort_if($input['scope'] === 'filtered' && !$filters, 422, '请添加筛选条件，或明确选择全员发放。');
        abort_if($input['scope'] !== 'filtered' && $filters, 422, '筛选条件与发放范围不一致。');
        if ($input['scope'] === 'ids') {
            abort_unless(!empty($input['user_ids']), 422, '请填写用户 ID。');
            $query->whereIn('id', $input['user_ids']);
        } else abort_if(!empty($input['user_ids']), 422, '用户 ID 与发放范围不一致。');

        $id = DB::transaction(function () use ($input, $query, $request) {
            $coupon = Coupon::findOrFail($input['coupon_id']);
            self::validateCoupon($coupon);
            abort_if(DB::table('v2_coupon_campaign')->where('administrator_id',$request->user['id'])->where('status','draft')->where('expires_at','>',time())->count() >= 10, 429, '待确认预览过多，请稍后重试。');
            $id = DB::table('v2_coupon_campaign')->insertGetId([
                'preview_key'=>(string)Str::uuid(), 'administrator_id'=>$request->user['id'], 'coupon_id'=>$coupon->id,
                'terms'=>json_encode(self::terms($coupon), JSON_THROW_ON_ERROR), 'template_hash'=>self::hash($coupon),
                'scope'=>$input['scope'], 'status'=>'draft', 'matched_count'=>0, 'created_at'=>time(), 'expires_at'=>time()+600,
            ]);
            // The transaction's consistent read freezes the audience without storing credentials or filter values.
            $matched = 0;
            $query->select(['id','banned'])->chunkById(1000, function ($users) use ($id, $coupon, &$matched) {
                $ids = $users->pluck('id');
                $existing = DB::table('v2_coupon_wallet')->where('coupon_id',$coupon->id)->whereIn('user_id',$ids)->pluck('user_id')->all();
                $used = DB::table('v2_order')->where('coupon_id',$coupon->id)->whereNotIn('status',[2])->whereIn('user_id',$ids)->pluck('user_id')->all();
                $claimed = array_fill_keys(array_merge($existing, $used), true);
                $rows = [];
                foreach ($users as $user) {
                    $reason = $user->banned ? 'account_disabled' : (isset($claimed[$user->id]) ? 'already_claimed' : null);
                    $rows[] = ['campaign_id'=>$id,'user_id'=>$user->id,'status'=>$reason ? 'skipped' : 'pending','reason'=>$reason,
                        'available_at'=>time(),'updated_at'=>time()];
                }
                DB::table('v2_coupon_campaign_recipient')->insert($rows);
                $matched += count($rows);
            });
            DB::table('v2_coupon_campaign')->where('id',$id)->update(['matched_count'=>$matched]);
            return $id;
        }, 3);
        return self::present($id);
    }

    public static function confirm(string $key, int $administratorId): array
    {
        $id = DB::transaction(function () use ($key, $administratorId) {
            $batch = DB::table('v2_coupon_campaign')->where('preview_key',$key)->where('administrator_id',$administratorId)->lockForUpdate()->first();
            abort_unless($batch, 404);
            if (in_array($batch->status,['queued','completed'],true)) return $batch->id;
            abort_unless($batch->status === 'draft',409,'该预览已取消，请重新预览。');
            abort_if($batch->expires_at <= time(), 409, '预览已过期，请重新检查发放范围。');
            $coupon = Coupon::whereKey($batch->coupon_id)->lockForUpdate()->firstOrFail();
            self::validateCoupon($coupon);
            abort_unless(hash_equals($batch->template_hash, self::hash($coupon)), 409, '优惠券条款已改变，请重新预览。');
            $count = DB::table('v2_coupon_campaign_recipient')->where('campaign_id',$batch->id)->where('status','pending')->count();
            abort_unless($count > 0, 409, '没有需要发放的用户。');
            abort_if($coupon->limit_use !== null && $coupon->limit_use < $count, 409, '剩余库存不足，尚未开始发放。');
            if ($coupon->limit_use !== null) { $coupon->limit_use -= $count; $coupon->save(); }
            DB::table('v2_coupon_campaign')->where('id',$batch->id)->update([
                'status'=>'queued', 'confirmed_at'=>time(), 'reserved_remaining'=>$count, 'limited_stock'=>$coupon->limit_use !== null,
            ]);
            return $batch->id;
        }, 3);
        return self::present($id);
    }

    private static function releaseStock($batch, int $count): void
    {
        if ($count && $batch->limited_stock) {
            DB::table('v2_coupon')->where('id',$batch->coupon_id)->whereNotNull('limit_use')->increment('limit_use', $count);
        }
    }

    public static function cancel(int $id, int $administratorId): array
    {
        DB::transaction(function () use ($id, $administratorId) {
            $batch = DB::table('v2_coupon_campaign')->where('id',$id)->where('administrator_id',$administratorId)->lockForUpdate()->first();
            abort_unless($batch, 404);
            if (!in_array($batch->status,['draft','queued'],true)) return;
            self::releaseStock($batch, (int)$batch->reserved_remaining);
            DB::table('v2_coupon_campaign_recipient')->where('campaign_id',$id)->where('status','pending')->update(['status'=>'cancelled','reason'=>'cancelled','updated_at'=>time()]);
            DB::table('v2_coupon_campaign')->where('id',$id)->update(['status'=>'cancelled','reserved_remaining'=>0,'finished_at'=>time()]);
        }, 3);
        return self::present($id);
    }

    public static function process(int $limit = 200): int
    {
        $ids = DB::table('v2_coupon_campaign_recipient as r')->join('v2_coupon_campaign as c','c.id','=','r.campaign_id')
            ->where('c.status','queued')->where('r.status','pending')->where('r.available_at','<=',time())->orderBy('r.id')
            ->limit(max(1,min($limit,1000)))->pluck('r.id');
        foreach ($ids as $id) {
            try {
                self::deliver((int)$id);
            } catch (\Throwable $e) {
                self::failedAttempt((int)$id);
                \Illuminate\Support\Facades\Log::warning('Coupon campaign delivery deferred', ['recipientId'=>$id,'exceptionClass'=>get_class($e)]);
            }
        }
        return count($ids);
    }

    private static function lockedRecipient(int $id): array
    {
        $row = DB::table('v2_coupon_campaign_recipient')->where('id',$id)->first();
        if (!$row) return [null,null];
        $batch = DB::table('v2_coupon_campaign')->where('id',$row->campaign_id)->lockForUpdate()->first();
        $row = DB::table('v2_coupon_campaign_recipient')->where('id',$id)->lockForUpdate()->first();
        if (!$batch || $batch->status !== 'queued' || !$row || $row->status !== 'pending' || $row->available_at > time()) return [null,null];
        return [$batch,$row];
    }

    private static function deliver(int $id): void
    {
        DB::transaction(function () use ($id) {
            [$batch,$row] = self::lockedRecipient($id);
            if (!$batch) return;
            $result = CouponWallet::deliverReserved((int)$row->user_id, (int)$batch->coupon_id,
                json_decode($batch->terms,true,512,JSON_THROW_ON_ERROR), (int)$batch->administrator_id);
            self::finishRecipient($batch,$row,$result['reason'] === 'issued' ? 'issued' : 'skipped',$result['reason'],$result['walletId']);
        }, 3);
    }

    private static function failedAttempt(int $id): void
    {
        DB::transaction(function () use ($id) {
            [$batch,$row] = self::lockedRecipient($id);
            if (!$batch) return;
            if ($row->attempts >= 2) self::finishRecipient($batch,$row,'failed','delivery_failed',null);
            else DB::table('v2_coupon_campaign_recipient')->where('id',$id)->update(['attempts'=>$row->attempts+1,'available_at'=>time()+60,'updated_at'=>time()]);
        },3);
    }

    private static function finishRecipient($batch, $row, string $status, string $reason, ?int $walletId): void
    {
        if ($status !== 'issued') self::releaseStock($batch,1);
        DB::table('v2_coupon_campaign_recipient')->where('id',$row->id)->update([
            'status'=>$status,'reason'=>$reason,'wallet_id'=>$walletId,'attempts'=>$row->attempts+1,'updated_at'=>time(),
        ]);
        $remaining = max(0,(int)$batch->reserved_remaining-1);
        DB::table('v2_coupon_campaign')->where('id',$batch->id)->update([
            'reserved_remaining'=>$remaining,'status'=>$remaining ? 'queued' : 'completed','finished_at'=>$remaining ? null : time(),
        ]);
    }

    public static function present(int $id): array
    {
        $batch = DB::table('v2_coupon_campaign')->where('id',$id)->first();
        abort_unless($batch,404);
        $terms = json_decode($batch->terms,true,512,JSON_THROW_ON_ERROR);
        $counts = DB::table('v2_coupon_campaign_recipient')->where('campaign_id',$id)->select('status')->selectRaw('COUNT(*) as total')->groupBy('status')->pluck('total','status');
        $coupon = Coupon::find($batch->coupon_id);
        return ['id'=>(int)$batch->id,'previewKey'=>$batch->preview_key,'couponName'=>$terms['name'],'discountPercent'=>(int)$terms['value'],
            'scope'=>$batch->scope,'status'=>$batch->status,'matched'=>(int)$batch->matched_count,'pending'=>(int)($counts['pending']??0),
            'issued'=>(int)($counts['issued']??0),'skipped'=>(int)($counts['skipped']??0),'failed'=>(int)($counts['failed']??0),
            'cancelled'=>(int)($counts['cancelled']??0),'stock'=>$coupon && $coupon->limit_use !== null ? (int)$coupon->limit_use : null,
            'expiresAt'=>(int)$batch->expires_at,'createdAt'=>(int)$batch->created_at,'administratorId'=>(int)$batch->administrator_id];
    }
}
