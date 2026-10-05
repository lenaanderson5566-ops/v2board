<?php
namespace App\Console\Commands;
use App\Models\User;
use App\Services\CreditExpiryService;
use Illuminate\Support\Facades\DB;
class ExpireCredits extends \Illuminate\Console\Command {
    protected $signature='credits:expire';
    protected $description='Expire unused traffic credit batches';
    public function handle() {
        DB::table('v2_credit_batch')->where('expires_at','<=',time())->where('remaining_bytes','>',0)->orderBy('id')->chunkById(500,function($rows) {
            foreach($rows->pluck('user_id')->unique()->sort() as $id) DB::transaction(function() use ($id) {
                $user=User::whereKey($id)->lockForUpdate()->first();
                if ($user) { CreditExpiryService::expire($user); $user->save(); }
            },3);
        });
        return 0;
    }
}
