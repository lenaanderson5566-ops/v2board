<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\TelegramCommunityService;
use App\Services\TelegramService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
class TelegramController extends Controller {
    public function status(TelegramCommunityService $service) {
        $query=DB::table('v2_telegram_group_member')->where('chat_id',$service->chatId());
        return response(['data'=>[
            'enabled'=>$service->enabled(),'knownMembers'=>(clone $query)->count(),
            'pendingChecks'=>(clone $query)->where('next_check_at','<=',time())->count(),
            'failures'=>(clone $query)->whereNotNull('error_code')->count(),
            'lastSync'=>Cache::get('telegram:last-sync'),
            'notificationSync'=>Cache::get('telegram:notify-last'),
            'notificationCounts'=>DB::table('v2_telegram_notification')->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total','status'),
            'notificationFailures'=>DB::table('v2_telegram_notification')->whereIn('status',['failed','uncertain'])->orderByDesc('id')->limit(20)->get(['id','kind','status','error_code','created_at']),
            'members'=>(clone $query)->orderByRaw('error_code IS NULL')->orderByDesc('checked_at')->limit(50)->get(['telegram_id','status','policy_banned','checked_at','error_code']),
        ]]);
    }
    public function inspect(TelegramCommunityService $service) {
        abort_unless($service->chatId()<0,422,'请先保存群 ID');
        $api=new TelegramService();
        $bot=$api->getMe()->result;
        $chat=$api->call('getChat',['chat_id'=>$service->chatId()])->result;
        $member=$api->call('getChatMember',['chat_id'=>$service->chatId(),'user_id'=>$bot->id])->result;
        return response(['data'=>[
            'botUsername'=>$bot->username,'chatTitle'=>$chat->title??'', 'chatType'=>$chat->type,
            'isPrivate'=>empty($chat->username),'canInvite'=>(bool)($member->can_invite_users??false),
            'canRestrict'=>(bool)($member->can_restrict_members??false),
            'administrator'=>$member->status==='administrator',
        ]]);
    }
    public function import(Request $request, TelegramCommunityService $service) {
        $data=$request->validate(['telegramIds'=>'required|array|min:1|max:1000','telegramIds.*'=>'required|string|regex:/^[1-9][0-9]{0,15}$/D']);
        abort_unless($service->chatId()<0,422,'请先保存群 ID');
        foreach (array_unique($data['telegramIds']) as $id) DB::table('v2_telegram_group_member')->insertOrIgnore(['chat_id'=>$service->chatId(),'telegram_id'=>(int)$id,'next_check_at'=>0]);
        return response(['data'=>['imported'=>count(array_unique($data['telegramIds']))]]);
    }
}
