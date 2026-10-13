<?php
namespace App\Services;

use App\Exceptions\TelegramApiException;
use App\Models\User;
use App\Models\Order;
use App\Models\Ticket;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class TelegramNotificationService {
    public function preferences(User $user) {
        return DB::table('v2_telegram_preference')->where('user_id',$user->id)->where('telegram_id',$user->telegram_id)->first();
    }
    public function ensurePreferences(User $user): void {
        if ($this->preferences($user)) return;
        DB::table('v2_telegram_preference')->updateOrInsert(['user_id'=>$user->id],[
            'telegram_id'=>$user->telegram_id,'expiry'=>false,'ticket'=>false,'order'=>false,'quiet'=>true,'blocked'=>false,'updated_at'=>time(),
        ]);
    }
    private function category(string $kind): string {
        return in_array($kind,['order','ticket'],true)?$kind:'expiry';
    }
    private function enqueue(User $user, string $kind, int $reference): void {
        $pref=$this->preferences($user);
        $category=$this->category($kind);
        if (!$pref || !$pref->$category || $pref->blocked) return;
        $key=hash('sha256',implode(':',[$user->id,$user->telegram_id,$kind,$reference]));
        DB::table('v2_telegram_notification')->insertOrIgnore([
            'event_key'=>$key,'user_id'=>$user->id,'telegram_id'=>$user->telegram_id,
            'kind'=>$kind,'reference_id'=>$reference,'next_at'=>time(),'created_at'=>time(),
        ]);
    }
    public function collect(): int {
        $cursor=(int)Cache::get('telegram:notification-cursor',0);
        $ids=DB::table('v2_telegram_preference')->where('user_id','>',$cursor)->where('blocked',false)
            ->where(function ($q) { $q->where('expiry',true)->orWhere('ticket',true)->orWhere('order',true); })
            ->orderBy('user_id')->limit(100)->pluck('user_id');
        foreach (User::whereIn('id',$ids)->where('banned',0)->whereNotNull('telegram_id')->get() as $user) {
            if (!$this->preferences($user)) continue;
            $expiry=(int)$user->expired_at;
            if ($user->plan_id && $expiry>0) {
                $left=$expiry-time();
                if ($left>0 && $left<=3*86400) $this->enqueue($user,$left>86400?'expiry_3d':'expiry_1d',$expiry);
                $group=app(TelegramCommunityService::class);
                $graceEnd=$expiry+$group->graceDays()*86400;
                if ($group->enabled() && $left<=0 && $graceEnd>time()) {
                    $this->enqueue($user,($graceEnd-time())<=86400?'grace_last':'grace_started',$expiry);
                }
            }
            $pref=$this->preferences($user);
            if ($pref->order) {
                foreach (Order::where('user_id',$user->id)->where('status',3)->where('type','!=',9)->where('updated_at','>=',time()-172800)->orderBy('id')->get(['id']) as $order) $this->enqueue($user,'order',(int)$order->id);
            }
            if ($pref->ticket) {
                $replies=DB::table('v2_ticket_message as m')->join('v2_ticket as t','t.id','=','m.ticket_id')
                    ->join('v2_user as a','a.id','=','m.user_id')->where('t.user_id',$user->id)->where('t.reply_status',1)
                    ->whereColumn('m.user_id','!=','t.user_id')->where(function ($q) { $q->where('a.is_admin',1)->orWhere('a.is_staff',1); })
                    ->where('m.created_at','>=',time()-172800)->selectRaw('MAX(m.id) as message_id')->groupBy('t.id')->get();
                // Coalesce consecutive staff replies to the latest message in each ticket.
                foreach ($replies as $reply) $this->enqueue($user,'ticket',(int)$reply->message_id);
            }
        }
        Cache::put('telegram:notification-cursor',$ids->count()===100?(int)$ids->last():0,86400);
        return $ids->count();
    }
    private function content($row, User $user): ?array {
        $menu=app(TelegramBotMenu::class);
        $route='dashboard';
        if ($row->kind==='order') {
            $order=Order::where('id',$row->reference_id)->where('user_id',$user->id)->where('status',3)->where('type','!=',9)->first();
            if (!$order) return null;
            $text='你的服务订单已完成，权益已到账。请登录网站查看套餐或额度详情。';
        } elseif ($row->kind==='ticket') {
            $reply=DB::table('v2_ticket_message as m')->join('v2_ticket as t','t.id','=','m.ticket_id')
                ->join('v2_user as a','a.id','=','m.user_id')->where('m.id',$row->reference_id)->where('t.user_id',$user->id)->where('t.reply_status',1)
                ->whereColumn('m.user_id','!=','t.user_id')->where(function ($q) { $q->where('a.is_admin',1)->orWhere('a.is_staff',1); })->first(['t.id']);
            if (!$reply) return null;
            if (DB::table('v2_ticket_message')->where('ticket_id',$reply->id)->where('id','>',$row->reference_id)->exists()) return null;
            $text='你的工单有客服回复，请登录网站查看。为保护隐私，机器人不转发工单正文。';
            $route='ticket';
        } else {
            if (!$user->plan_id || (int)$user->expired_at!==(int)$row->reference_id) return null;
            $expiry=(int)$user->expired_at;
            if (str_starts_with($row->kind,'grace_')) {
                $group=app(TelegramCommunityService::class);
                $end=$expiry+$group->graceDays()*86400;
                if (!$group->enabled() || $expiry>time() || $end<=time()) return null;
                if ($row->kind==='grace_started' && $end-time()<=86400) return null;
                $text='套餐已到期，当前仍在群资格宽限期内。宽限截止：'.TimeZones::format($end,$user).'。截止后将清退，续费后可重新申请入群。';
            } else {
                if ($expiry<=time()) return null;
                if ($row->kind==='expiry_3d' && $expiry-time()<=86400) return null;
                $text='套餐即将到期：'.TimeZones::format($expiry,$user).'。请登录网站查看续费选项。';
            }
            $route='plan';
        }
        $payload=['chat_id'=>(int)$row->telegram_id,'text'=>$text];
        if ($url=$menu->url($route)) $payload['reply_markup']=json_encode(['inline_keyboard'=>[[['text'=>'登录网站查看','url'=>$url]]]],JSON_UNESCAPED_UNICODE);
        return $payload;
    }
    public function deliver(): array {
        // A process crash after a remote send is ambiguous; never blindly resend it.
        DB::table('v2_telegram_notification')->where('status','sending')->where('next_at','<',time()-300)->update(['status'=>'uncertain','error_code'=>'OUTCOME_UNKNOWN','finished_at'=>time()]);
        $counts=['sent'=>0,'failed'=>0,'cancelled'=>0];
        $rows=DB::table('v2_telegram_notification')->where('status','pending')->where('next_at','<=',time())->orderBy('next_at')->orderBy('id')->limit(20)->get();
        foreach ($rows as $row) {
            $query=DB::table('v2_telegram_notification')->where('id',$row->id);
            $user=User::find($row->user_id);
            $pref=$user?$this->preferences($user):null;
            $category=$this->category($row->kind);
            $payload=null;
            if ($user && !$user->banned && (string)$user->telegram_id===(string)$row->telegram_id && $pref && !$pref->blocked && $pref->$category && $row->created_at>time()-172800
                && app(TelegramCommunityService::class)->userForTelegram((int)$row->telegram_id)?->id===$user->id) $payload=$this->content($row,$user);
            if (!$payload) { $query->update(['status'=>'cancelled','finished_at'=>time()]); $counts['cancelled']++; continue; }
            $now=new \DateTimeImmutable('now',new \DateTimeZone(TimeZones::forUser($user)));
            if ($pref->quiet && ((int)$now->format('G')>=22 || (int)$now->format('G')<8)) {
                $next=(int)$now->format('G')>=22?$now->modify('tomorrow 08:00'):$now->setTime(8,0);
                $query->update(['next_at'=>$next->getTimestamp()]); continue;
            }
            if (!$query->where('status','pending')->update(['status'=>'sending','attempts'=>$row->attempts+1,'next_at'=>time()])) continue;
            $query=DB::table('v2_telegram_notification')->where('id',$row->id);
            try {
                $sent=Cache::lock('telegram:binding-write',15)->block(3,function () use ($row,$category) {
                    $account=User::find($row->user_id);
                    $preference=$account?$this->preferences($account):null;
                    if (!$account || $account->banned || (string)$account->telegram_id!==(string)$row->telegram_id || !$preference || $preference->blocked || !$preference->$category) return false;
                    $hour=(int)(new \DateTimeImmutable('now',new \DateTimeZone(TimeZones::forUser($account))))->format('G');
                    if ($preference->quiet && ($hour>=22 || $hour<8)) return null;
                    $current=$this->content($row,$account);
                    if (!$current) return false;
                    (new TelegramService())->call('sendMessage',$current);
                    return true;
                });
                if ($sent===null) { $query->update(['status'=>'pending','next_at'=>time()+3600]); continue; }
                $status=$sent?'sent':'cancelled';
                $query->update(['status'=>$status,'finished_at'=>time(),'error_code'=>null]); $counts[$status]++;
            } catch (\Illuminate\Contracts\Cache\LockTimeoutException $e) {
                $query->update(['status'=>'pending','next_at'=>time()+60]);
                break;
            } catch (TelegramApiException $e) {
                $counts['failed']++;
                if ($e->telegramCode===403) DB::table('v2_telegram_preference')->where('user_id',$user->id)->where('telegram_id',$row->telegram_id)->update(['blocked'=>true]);
                if ($e->telegramCode===429 && $row->attempts<5) {
                    $query->update(['status'=>'pending','next_at'=>time()+$e->retryAfter,'error_code'=>'RATE_LIMITED']);
                    Cache::put('telegram:notify-backoff',true,$e->retryAfter);
                    break;
                }
                $uncertain=$e->telegramCode===0 || $e->telegramCode>=500;
                $query->update(['status'=>$uncertain?'uncertain':'failed','finished_at'=>time(),'error_code'=>$uncertain?'OUTCOME_UNKNOWN':'TELEGRAM_'.$e->telegramCode]);
            }
        }
        DB::table('v2_telegram_notification')->where('created_at','<',time()-30*86400)->whereNotIn('status',['pending','sending'])->delete();
        return $counts;
    }
}
