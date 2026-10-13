<?php
namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TelegramBotMenu {
    public function url(string $route='dashboard'): ?string {
        if (!in_array($route,['dashboard','ticket','plan','knowledge','profile'],true)) return null;
        $base=trim((string)config('v2board.app_url',''));
        $parts=parse_url($base);
        if (!$parts || ($parts['scheme']??'')!=='https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) return null;
        return rtrim($base,'/').'/#/'.$route;
    }
    public function send(int $chatId, string $page='home'): void {
        if ($chatId<=0) return;
        $user=app(TelegramCommunityService::class)->userForTelegram($chatId);
        $rows=[[['text'=>'我的套餐','callback_data'=>'view:account'],['text'=>'剩余流量','callback_data'=>'view:traffic']], [['text'=>'群资格','callback_data'=>'view:group'],['text'=>'通知设置','callback_data'=>'view:settings']]];
        $text='FastAI 服务助手\n可查询套餐、流量和群资格，接收服务提醒。账号与业务操作请登录网站办理。';
        if ($page==='settings' && $user) {
            $p=app(TelegramNotificationService::class)->preferences($user);
            $text="通知默认关闭，由你自行开启。夜间免打扰为你的通知时区 22:00–08:00，期间提醒延后发送。\n绑定变更后须重新开启通知。";
            $text.="\n通知时区：".TimeZones::forUser($user).'（在网站时间设置中修改；跟随设备时回退系统时区）。';
            $rows=[];
            foreach (['expiry'=>'套餐与群资格提醒','ticket'=>'工单回复提醒','order'=>'套餐到账提醒','quiet'=>'夜间免打扰'] as $key=>$label) {
                $value=(bool)($p->$key??($key==='quiet'));
                $rows[]=[['text'=>$label.'：'.($value?'开启':'关闭'),'callback_data'=>'pref:'.$key.':'.($value?'0':'1')]];
            }
        } elseif ($page!=='home') {
            if (!$user || $user->banned) $text='请先在网站绑定可用账号，再使用查询功能。';
            elseif ($page==='account') {
                $expiry=$user->expired_at===null?'长期有效':TimeZones::format((int)$user->expired_at,$user);
                $text=$user->plan_id ? "当前套餐到期时间：{$expiry}\n具体权益请在网站查看。" : '当前没有套餐，请在网站查看可用服务。';
            } elseif ($page==='traffic') {
                $remaining=(TrafficCreditService::hasPeriod($user)?max(0,$user->transfer_enable-$user->u-$user->d):0)+(int)$user->credit_balance;
                $text='剩余可用流量：'.\App\Utils\Helper::trafficConvert($remaining);
            } elseif ($page==='group') {
                $service=app(TelegramCommunityService::class);
                $text=$service->enabled() ? ($service->eligible($user)?'你具备群资格，请在网站账号设置中申请入群。':'当前不满足群资格，请在网站查看套餐状态。').' 到期宽限 '.$service->graceDays().' 天。' : '当前未启用群资格管理。';
            } else $text='请先在网站绑定账号，再设置通知偏好。';
        }
        foreach (['dashboard'=>'打开网站','ticket'=>'查看工单','plan'=>'查看套餐'] as $route=>$label) {
            if ($url=$this->url($route)) $rows[]=[['text'=>$label,'url'=>$url]];
        }
        (new TelegramService())->call('sendMessage',['chat_id'=>$chatId,'text'=>str_replace('\\n',"\n",$text),'reply_markup'=>json_encode(['inline_keyboard'=>$rows],JSON_UNESCAPED_UNICODE)]);
    }
    public function callback(array $callback): void {
        $id=(int)($callback['from']['id']??0);
        $message=$callback['message']??[];
        if ($id<=0 || !is_string($callback['id']??null) || strlen($callback['id'])>256 || ($message['chat']['type']??'')!=='private' || (int)($message['chat']['id']??0)!==$id || !($message['from']['is_bot']??false)) return;
        $api=new TelegramService();
        $allowed=Cache::add('telegram:menu-rate:'.$id,true,2);
        try { $api->call('answerCallbackQuery',['callback_query_id'=>$callback['id'],'text'=>$allowed?'请求已收到':'操作较快，请稍后重试']); }
        catch (\App\Exceptions\TelegramApiException $e) {
            if ($e->telegramCode===400) return; // Expired buttons do not mutate preferences.
            throw $e;
        }
        if (!$allowed) return;
        $data=(string)($callback['data']??'');
        if (preg_match('/^view:(home|account|traffic|group|settings)$/D',$data,$match)) { $this->send($id,$match[1]); return; }
        if (!preg_match('/^pref:(expiry|ticket|order|quiet):([01])$/D',$data,$match)) return;
        Cache::lock('telegram:binding-write',15)->block(2,function () use ($id,$match) {
            $user=app(TelegramCommunityService::class)->userForTelegram($id);
            if (!$user) return;
            $service=app(TelegramNotificationService::class);
            $service->ensurePreferences($user);
            DB::table('v2_telegram_preference')->where('user_id',$user->id)->where('telegram_id',$id)->update([$match[1]=>(int)$match[2],'blocked'=>false,'updated_at'=>time()]);
        });
        $this->send($id,'settings');
    }
}
