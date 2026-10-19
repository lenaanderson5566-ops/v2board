<?php
namespace App\Services;

/** Presentation policy only. Authentication and API authorization remain independent. */
final class BrowserAccess
{
    public const DEFAULTS = ['wechat'=>'guide','qq'=>'guide','weibo'=>'guide','xiaohongshu'=>'allow','douyin'=>'allow','bilibili'=>'allow','alipay'=>'allow','dingtalk'=>'allow','wecom'=>'allow','other'=>'allow'];
    public static function policies(): array {
        $result=[];
        foreach (self::DEFAULTS as $key=>$default) {
            $value=config('v2board.browser_policy_'.$key,$default);
            $result[$key]=in_array($value,['allow','prompt','guide'],true) ? $value : $default;
        }
        return $result;
    }
    public static function classify(?string $input): array {
        $ua=substr($input ?? '',0,1024);
        $embedded=preg_match('/MicroMessenger/i',$ua) ? 'wechat' : (preg_match('/\bQQ\//i',$ua) ? 'qq' : (preg_match('/Weibo/i',$ua) ? 'weibo' : (preg_match('/; wv\)|\bFBAN\/|\bFBAV\/|Instagram/i',$ua) ? 'other' : 'none')));
        foreach (['xiaohongshu'=>'XiaoHongShu', 'douyin'=>'Aweme', 'bilibili'=>'BiliApp', 'alipay'=>'AlipayClient', 'dingtalk'=>'DingTalk', 'wecom'=>'wxwork'] as $key=>$marker) { if (stripos($ua,$marker)!==false) {$embedded=$key;break;} }
        $os=preg_match('/iPhone|iPad|iPod/i',$ua) ? 'ios' : (stripos($ua,'Android')!==false ? 'android' : (stripos($ua,'Windows')!==false ? 'windows' : (stripos($ua,'Macintosh')!==false ? 'macos' : (stripos($ua,'Linux')!==false ? 'linux' : 'unknown'))));
        $browser='unknown'; $major=null;
        foreach (['samsung'=>'SamsungBrowser','uc'=>'UCBrowser','qqbrowser'=>'M?QQBrowser','edge'=>'Edg(?:e|A|iOS)?','opera'=>'OPR|OPiOS','firefox'=>'Firefox|FxiOS','chrome'=>'Chrome|CriOS','safari'=>'Version'] as $family=>$pattern) {
            if ($family==='safari' && stripos($ua,'Safari')===false) continue;
            if (preg_match('~(?:'.$pattern.')/([0-9]{1,3})(?:[. /]|$)~i',$ua,$m)) {$browser=$family;$major=(int)$m[1];break;}
        }
        // Brand-only tokens do not supply a reliable application version.
        if (preg_match('/\b360(?:SE|EE)\b/i',$ua)) {$browser='360';$major=null;}
        elseif (preg_match('/SogouMobileBrowser\/([0-9]{1,3})(?:[. \/]|$)/i',$ua,$match)) {$browser='sogou';$major=(int)$match[1];}
        elseif (preg_match('/SE[ \/][0-9.]+.*MetaSr|Sogou/i',$ua)) {$browser='sogou';$major=null;}
        return ['browser'=>$browser,'browser_major'=>$major,'os'=>$os,'embedded'=>$embedded];
    }
    /** Fixed SQL categories: raw user-agent strings never leave the database. */
    public static function logCategorySql(): string {
        return "CASE WHEN LOWER(user_agent) LIKE '%xiaohongshu%' THEN 'xiaohongshu' WHEN LOWER(user_agent) LIKE '%aweme%' THEN 'douyin' WHEN LOWER(user_agent) LIKE '%biliapp%' THEN 'bilibili' WHEN LOWER(user_agent) LIKE '%alipayclient%' THEN 'alipay' WHEN LOWER(user_agent) LIKE '%dingtalk%' THEN 'dingtalk' WHEN LOWER(user_agent) LIKE '%wxwork%' THEN 'wecom' WHEN LOWER(user_agent) LIKE '%micromessenger%' THEN 'wechat' WHEN LOWER(user_agent) LIKE '%qq/%' THEN 'qq' WHEN LOWER(user_agent) LIKE '%weibo%' THEN 'weibo' WHEN LOWER(user_agent) LIKE '%; wv)%' OR LOWER(user_agent) LIKE '%fban/%' OR LOWER(user_agent) LIKE '%fbav/%' OR LOWER(user_agent) LIKE '%instagram%' THEN 'embedded_other' WHEN LOWER(user_agent) LIKE '%360se%' OR LOWER(user_agent) LIKE '%360ee%' THEN '360' WHEN LOWER(user_agent) LIKE '%sogou%' OR LOWER(user_agent) LIKE '%metasr%' THEN 'sogou' WHEN LOWER(user_agent) LIKE '%samsungbrowser/%' THEN 'samsung' WHEN LOWER(user_agent) LIKE '%ucbrowser/%' THEN 'uc' WHEN LOWER(user_agent) LIKE '%qqbrowser/%' THEN 'qqbrowser' WHEN LOWER(user_agent) LIKE '%edg/%' OR LOWER(user_agent) LIKE '%edga/%' OR LOWER(user_agent) LIKE '%edgios/%' OR LOWER(user_agent) LIKE '%edge/%' THEN 'edge' WHEN LOWER(user_agent) LIKE '%opr/%' OR LOWER(user_agent) LIKE '%opios/%' THEN 'opera' WHEN LOWER(user_agent) LIKE '%firefox/%' OR LOWER(user_agent) LIKE '%fxios/%' THEN 'firefox' WHEN LOWER(user_agent) LIKE '%chrome/%' OR LOWER(user_agent) LIKE '%crios/%' THEN 'chrome' WHEN LOWER(user_agent) LIKE '%safari/%' AND LOWER(user_agent) LIKE '%version/%' THEN 'safari' ELSE 'unknown' END";
    }
}
