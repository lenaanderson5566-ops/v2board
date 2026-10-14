<?php
namespace App\Services;
use App\Models\User;
use Illuminate\Support\Facades\DB;
class TelegramText {
    public static function normalize(string $language): string {
        if (in_array($language,LanguagePreferenceService::SUPPORTED,true)) return $language;
        $language=strtolower(str_replace('_','-',$language));
        if (str_starts_with($language,'zh')) return preg_match('/tw|hk|hant/',$language)?'zh-TW':'zh-CN';
        foreach (LanguagePreferenceService::SUPPORTED as $supported) if (strtolower(explode('-',$supported)[0])===explode('-',$language)[0]) return $supported;
        return 'en-US';
    }
    public static function language(int $id,string $fallback='',string $argument=''): string {
        $user=app(TelegramCommunityService::class)->userForTelegram($id);
        // Before binding, use the website account associated with the unexpired challenge.
        if (!$user && preg_match('/^bind_([a-f0-9]{48})$/D',$argument,$m)) {
            $challenge=DB::table('v2_telegram_binding_challenge')->where('token_hash',hash('sha256',$m[1]))->where('expires_at','>',time())->first();
            if ($challenge) $user=User::find($challenge->user_id);
        }
        return self::normalize($user->language ?? $fallback);
    }
    public static function get(string $key,string $language,array $replace=[]): string {
        $catalog=require resource_path('lang/telegram.php');
        $text=$catalog[self::normalize($language)][$key] ?? $catalog['en-US'][$key] ?? $key;
        foreach ($replace as $name=>$value) $text=str_replace(':'.$name,(string)$value,$text);
        return $text;
    }
    public static function commandMenus(): array {
        $labels=[
            'en'=>['Link account and help','How to link your account','How to unlink your account','Check group eligibility'],
            'zh'=>['绑定账号与使用说明','查看安全绑定方式','查看解除绑定方式','查询用户群资格'],
            'ja'=>['アカウント連携と使い方','連携方法','連携解除方法','グループ参加資格'],
            'ko'=>['계정 연결 및 안내','계정 연결 방법','계정 연결 해제 방법','그룹 가입 자격 확인'],
            'vi'=>['Liên kết tài khoản và hướng dẫn','Cách liên kết tài khoản','Cách hủy liên kết','Điều kiện tham gia nhóm'],
            'ru'=>['Привязка аккаунта и справка','Как привязать аккаунт','Как отвязать аккаунт','Доступ к группе'],
            'fa'=>['اتصال حساب و راهنما','روش اتصال حساب','روش قطع اتصال حساب','بررسی شرایط عضویت'],
        ];
        $menus=[];
        foreach ($labels as $locale=>$values) foreach (array_combine(['start','bind','unbind','group'],$values) as $command=>$description) $menus[$locale][]=['command'=>$command,'description'=>$description];
        return $menus;
    }
    public static function commandsFor(string $language): array {
        if (self::normalize($language)==='zh-TW') {
            $menu=[];
            foreach (array_combine(['start','bind','unbind','group'],['綁定帳號與使用說明','查看安全綁定方式','查看解除綁定方式','查詢用戶群資格']) as $command=>$description) $menu[]=['command'=>$command,'description'=>$description];
            return $menu;
        }
        return self::commandMenus()[explode('-',self::normalize($language))[0]] ?? self::commandMenus()['en'];
    }
}
