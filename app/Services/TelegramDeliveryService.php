<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Request;

class TelegramDeliveryService {
    public static function botKey(): string { return hash('sha256',(string)config('v2board.telegram_bot_token')); }
    public function receive(array $data): void {
        abort_unless(isset($data['update_id']) && is_int($data['update_id']) && $data['update_id']>=0,422,'Invalid Telegram update');
        abort_if(strlen(json_encode($data))>65536,413,'Telegram update too large');
        $key=self::botKey();
        if (DB::table('v2_telegram_update')->where('bot_key',$key)->where('update_id',$data['update_id'])->exists()) return;
        // Keep only fields consumed by membership logic; never retain arbitrary chat content.
        $safe=['update_id'=>$data['update_id']];
        foreach (['chat_join_request','chat_member','my_chat_member','message'] as $type) {
            $event=$data[$type]??null;
            if (!is_array($event)) continue;
            $chat=$event['chat']??[]; $from=$event['from']??[];
            if (!is_array($chat) || !is_array($from) || !is_int($chat['id']??null) || !is_int($from['id']??null)) continue;
            $keep=['chat'=>array_intersect_key($chat,array_flip(['id','type'])), 'from'=>array_intersect_key($from,array_flip(['id','is_bot','username','first_name','language_code']))];
            if (($chat['type']??'')!=='private' && (int)$chat['id']!==app(TelegramCommunityService::class)->chatId()) continue;
            if ($type==='message') {
                if (($chat['type']??'')==='private') {
                    $text=$event['text']??'';
                    if (!is_string($text) || strlen($text)>160 || !preg_match('/^\/(start|bind|unbind|group)(?:@[A-Za-z0-9_]{5,32})?(?:\s+bind_[a-f0-9]{48})?\s*$/D',$text)) continue;
                    if (!Cache::add('telegram:command-rate:'.$key.':'.$from['id'],true,2)) { abort(429,'Retry later'); }
                    $keep['text']=$text;
                }
                $keep['message_id']=(int)($event['message_id']??0);
                $keep['new_chat_members']=array_map(fn($m)=>array_intersect_key($m,array_flip(['id','is_bot'])),array_filter(is_array($event['new_chat_members']??null)?$event['new_chat_members']:[],'is_array'));
            }
            if ($type==='chat_member' && is_array($event['new_chat_member']??null)) {
                $member=$event['new_chat_member'];
                $keep['new_chat_member']=['status'=>$member['status']??'', 'user'=>array_intersect_key(is_array($member['user']??null)?$member['user']:[],array_flip(['id','is_bot']))];
            }
            $safe[$type]=$keep;
        }
        if (count($safe)===1) return;
        DB::table('v2_telegram_update')->insertOrIgnore(['bot_key'=>$key,'update_id'=>$data['update_id'], 'payload'=>Crypt::encryptString(json_encode($safe,JSON_THROW_ON_ERROR)), 'created_at'=>time()]);
        $id=DB::table('v2_telegram_update')->where('bot_key',$key)->where('update_id',$data['update_id'])->value('id');
        try { if (config('queue.connections.'.config('queue.default').'.driver') !== 'sync') \App\Jobs\ProcessTelegramUpdateJob::dispatch((int)$id); } catch (\Throwable $e) { /* Scheduler recovers pending records. */ }
    }
    public function process(int $id): void {
        $q=DB::table('v2_telegram_update')->where('id',$id);
        if (!(clone $q)->where('status','pending')->where('next_at','<=',time())->update(['status'=>'processing','next_at'=>time()+120])) return;
        $row=$q->first();
        if ($row->bot_key!==self::botKey() || !config('v2board.telegram_bot_enable',0)) { $q->update(['status'=>'cancelled','payload'=>null]); return; }
        try {
            $payload=json_decode(Crypt::decryptString($row->payload),true,32,JSON_THROW_ON_ERROR);
            $request=Request::create('/api/v10/webhooks/telegram','POST',$payload);
            $request->headers->set('X-Telegram-Bot-Api-Secret-Token',md5(config('v2board.telegram_bot_token')));
            (new \App\Services\Actions\Guest\TelegramActions($request))->processUpdate($payload);
            $q->update(['status'=>'done','payload'=>null,'error_code'=>null]);
        } catch (\App\Exceptions\TelegramApiException $e) {
            $retry=$e->telegramCode===429 && $row->attempts<5;
            // Transport failures may follow a successful remote mutation: do not blindly repeat.
            $q->update(['status'=>$retry?'pending':($e->telegramCode===0?'uncertain':'failed'), 'attempts'=>$row->attempts+1,'next_at'=>time()+$e->retryAfter,'error_code'=>'TELEGRAM_'.($e->telegramCode?:'UNKNOWN'),'payload'=>$retry?$row->payload:null]);
        } catch (\Throwable $e) {
            $q->update(['status'=>'uncertain','payload'=>null,'error_code'=>$e instanceof \Illuminate\Database\QueryException ? 'DATABASE_ERROR' : ($e instanceof \ErrorException ? 'INVALID_RESPONSE' : 'PROCESSING_FAILED')]);
        }
    }
}
