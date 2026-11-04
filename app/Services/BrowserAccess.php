<?php
namespace App\Services;

/** Presentation policy only. Authentication and API authorization remain independent. */
final class BrowserAccess
{
    public const DEFAULTS = ['wechat'=>'guide','qq'=>'guide','weibo'=>'guide','xiaohongshu'=>'allow','douyin'=>'allow','bilibili'=>'allow','alipay'=>'allow','dingtalk'=>'allow','wecom'=>'guide','other'=>'allow'];
    // Fixed, bounded markers shared by presentation attribution and log grouping.
    // These are hints, never authentication or API access rules.
    private const EMBEDDED_PATTERNS = [
        'wecom'=>'wxwork',
        'xiaohongshu'=>'XiaoHongShu',
        'douyin'=>'Aweme',
        'bilibili'=>'BiliApp',
        'alipay'=>'AlipayClient',
        'dingtalk'=>'DingTalk',
        'wechat'=>'MicroMessenger',
        'qq'=>'(^|[^a-z0-9_])QQ/',
        'weibo'=>'Weibo',
        'other'=>';[[:space:]]*wv([);[:space:]]|$)|(^|[^a-z0-9_])(FBAN/|FBAV/|FB_IAB/)|(^|[^a-z0-9_])Instagram([ /;]|$)',
    ];
    public static function policies(): array {
        $result=[];
        foreach (self::DEFAULTS as $key=>$default) {
            $value=config('fastai.browser_policy_'.$key,$default);
            $result[$key]=in_array($value,['allow','prompt','guide'],true) ? $value : $default;
        }
        return $result;
    }
    /** Fixed SQL categories: raw user-agent strings never leave the database. */
    public static function logCategorySql(): string {
        $ua='LOWER(LEFT(user_agent,1024))';
        $cases=[];
        foreach (self::EMBEDDED_PATTERNS as $key=>$pattern) {
            $category=$key==='other' ? 'embedded_other' : $key;
            $condition=in_array($key,['qq','other'],true)
                ? "{$ua} REGEXP '".strtolower($pattern)."'"
                : "{$ua} LIKE '%".strtolower($pattern)."%'";
            $cases[]="WHEN {$condition} THEN '{$category}'";
        }
        return 'CASE '.implode(' ',$cases)." WHEN {$ua} LIKE '%360se%' OR {$ua} LIKE '%360ee%' THEN '360' WHEN {$ua} LIKE '%sogou%' OR {$ua} LIKE '%metasr%' THEN 'sogou' WHEN {$ua} LIKE '%samsungbrowser/%' THEN 'samsung' WHEN {$ua} LIKE '%ucbrowser/%' THEN 'uc' WHEN {$ua} LIKE '%qqbrowser/%' THEN 'qqbrowser' WHEN {$ua} LIKE '%edg/%' OR {$ua} LIKE '%edga/%' OR {$ua} LIKE '%edgios/%' OR {$ua} LIKE '%edge/%' THEN 'edge' WHEN {$ua} LIKE '%opr/%' OR {$ua} LIKE '%opios/%' THEN 'opera' WHEN {$ua} LIKE '%firefox/%' OR {$ua} LIKE '%fxios/%' THEN 'firefox' WHEN {$ua} LIKE '%chrome/%' OR {$ua} LIKE '%crios/%' THEN 'chrome' WHEN {$ua} LIKE '%safari/%' AND {$ua} LIKE '%version/%' THEN 'safari' ELSE 'unknown' END";
    }
}
