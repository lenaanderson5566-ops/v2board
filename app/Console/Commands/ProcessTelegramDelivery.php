<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
class ProcessTelegramDelivery extends Command {
    protected $signature='telegram:process';
    protected $description='Recover pending Telegram events and payment receipts';
    public function handle(): int {
        DB::table('v2_telegram_update')->where('status','processing')->where('next_at','<',time())->update(['status'=>'uncertain','payload'=>null,'error_code'=>'WORKER_INTERRUPTED']);
        DB::table('v2_telegram_payment_notice')->where('status','sending')->where('next_at','<',time())->update(['status'=>'uncertain','error_code'=>'WORKER_INTERRUPTED']);
        DB::table('v2_telegram_update')->where('created_at','<',time()-86400)->where('status','pending')->update(['status'=>'expired','payload'=>null]);
        foreach (DB::table('v2_telegram_update')->where('status','pending')->where('next_at','<=',time())->orderBy('id')->limit(10)->pluck('id') as $id) (new \App\Jobs\ProcessTelegramUpdateJob((int)$id))->handle();
        foreach (DB::table('v2_telegram_payment_notice')->where('status','pending')->where('next_at','<=',time())->orderBy('id')->limit(10)->pluck('id') as $id) (new \App\Jobs\SendTelegramPaymentJob((int)$id))->handle();
        DB::table('v2_telegram_update')->where('created_at','<',time()-7*86400)->whereNotIn('status',['pending','processing'])->delete();
        // Keep the small payment receipt rows for durable deduplication; no message bodies are stored.
        return 0;
    }
}
