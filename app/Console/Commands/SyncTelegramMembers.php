<?php
namespace App\Console\Commands;
use App\Services\TelegramCommunityService;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
class SyncTelegramMembers extends Command {
    protected $signature='telegram:sync-members';
    protected $description='Reconcile known Telegram members against account entitlement';
    public function handle(TelegramCommunityService $service): int {
        DB::table('v2_telegram_binding_challenge')->where('expires_at','<=',time())->delete();
        if (!$service->enabled()) return 0;
        $cursor=(int)Cache::get('telegram:seed-cursor:'.$service->chatId(),0);
        $users=User::where('id','>',$cursor)->whereNotNull('telegram_id')->orderBy('id')->limit(200)->get(['id','telegram_id']);
        foreach ($users as $user) DB::table('v2_telegram_group_member')->insertOrIgnore(['chat_id'=>$service->chatId(),'telegram_id'=>$user->telegram_id,'next_check_at'=>0]);
        Cache::put('telegram:seed-cursor:'.$service->chatId(),$users->count()===200?$users->last()->id:0,86400);
        $rows=DB::table('v2_telegram_group_member')->where('chat_id',$service->chatId())->where('next_check_at','<=',time())->orderBy('next_check_at')->orderBy('id')->limit(50)->get();
        $failed=0; $checked=0;
        foreach ($rows as $row) {
            $checked++;
            try { $service->reconcile((int)$row->telegram_id); }
            catch (\Throwable $e) {
                $failed++;
                DB::table('v2_telegram_group_member')->where('id',$row->id)->update(['next_check_at'=>time()+300,'error_code'=>in_array($row->error_code,['BAN_REQUIRES_REVIEW','MANUAL_BAN'],true)?$row->error_code:'TELEGRAM_CHECK_FAILED']);
                if ($failed>=3) break;
            }
        }
        Cache::put('telegram:last-sync',['at'=>time(),'checked'=>$checked,'failed'=>$failed],86400);
        $this->info('Checked '.$checked.' memberships; failed '.$failed.'.');
        return $failed?1:0;
    }
}
