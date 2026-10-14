<?php
namespace App\Jobs;
use App\Services\TelegramService;
use App\Services\TelegramDeliveryService;
use App\Services\TelegramText;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
class SendTelegramPaymentJob implements ShouldQueue {
    use Dispatchable,InteractsWithQueue,Queueable,SerializesModels;
    public $tries=1;
    public $timeout=30;
    protected $noticeId=null;
    public function __construct(int $noticeId) { $this->noticeId=$noticeId; $this->onQueue('send_telegram'); }
    public function handle(): void {
        // Old serialized jobs have no persistent receipt; do not replay their raw text.
        if (!$this->noticeId) return;
        $q=DB::table('v2_telegram_payment_notice')->where('id',$this->noticeId);
        if (!(clone $q)->where('status','pending')->where('next_at','<=',time())->update(['status'=>'sending','next_at'=>time()+120])) return;
        $row=$q->first();
        try {
            $user=\App\Models\User::find($row->user_id);
            $owner=app(\App\Services\TelegramCommunityService::class)->userForTelegram((int)$row->telegram_id);
            $order=\App\Models\Order::find($row->order_id);
            if (!config('v2board.telegram_bot_enable',0) || $row->bot_key!==TelegramDeliveryService::botKey() || !$user || !$owner || $owner->id!==$user->id || $user->banned || !$user->is_admin || (string)$user->telegram_id!==(string)$row->telegram_id || !$order || !$order->paid_at || !in_array((int)$order->status,[1,3],true)) {
                $q->update(['status'=>'cancelled']); return;
            }
            (new TelegramService())->sendMessage((int)$row->telegram_id,TelegramText::get('payment',TelegramText::normalize((string)$user->language),['amount'=>\App\Services\Money::format($order->total_amount, $order->currency ?: 'CNY'),'order'=>$order->trade_no]));
            $q->update(['status'=>'sent','error_code'=>null]);
        } catch (\App\Exceptions\TelegramApiException $e) {
            $retry=$e->telegramCode===429 && $row->attempts<5;
            $q->update(['status'=>$retry?'pending':($e->telegramCode===0?'uncertain':'failed'),'attempts'=>$row->attempts+1,'next_at'=>time()+$e->retryAfter,'error_code'=>'TELEGRAM_'.($e->telegramCode?:'UNKNOWN')]);
        } catch (\Throwable $e) {
            $q->update(['status'=>'uncertain','error_code'=>'DELIVERY_UNKNOWN']);
        }
    }
}
