<?php
namespace App\Services;

use App\Models\User;

/** Rendering is independent of the queue and never sends mail. */
class ProductMail
{
    const TYPES = ['verify', 'mailLogin', 'remindTraffic', 'remindExpire', 'serviceActivated', 'serviceRenewed', 'notify', 'emailInvitation', 'ticketReply', 'test'];
    public static function language($value)
    {
        $value = strtolower(str_replace('_', '-', (string)$value));
        $aliases = ['zh'=>'zh-CN','zh-cn'=>'zh-CN','zh-hans'=>'zh-CN','zh-tw'=>'zh-TW','zh-hk'=>'zh-TW','zh-hant'=>'zh-TW','zh-hant-tw'=>'zh-TW','zh-hant-hk'=>'zh-TW','zh-hans-cn'=>'zh-CN', 'en'=>'en-US','ja'=>'ja-JP','ko'=>'ko-KR','vi'=>'vi-VN','ru'=>'ru-RU','fa'=>'fa-IR'];
        foreach (LanguagePreferenceService::SUPPORTED as $language) if (strtolower($language) === $value) return $language;
        return $aliases[$value] ?? ($aliases[explode('-', $value)[0]] ?? null);
    }
    public function data(array $params)
    {
        $type = $params['template_name'] ?? 'notify';
        if (!in_array($type, self::TYPES, true)) throw new \InvalidArgumentException('Unsupported email template.');
        $language = self::language($params['language'] ?? null);
        if (!$language && !empty($params['email'])) $language = self::language(User::where('email', $params['email'])->value('language'));
        $language = $language ?: self::language(config('v2board.email_default_language')) ?: 'zh-CN';
        if ($type === 'notify' && empty($params['translations'][$language]) && !empty($params['source_language'])) {
            $language = self::language($params['source_language']) ?: $language;
        }
        $copy = require resource_path('mail/copy.php');
        $copy = $copy[$language];
        $value = $params['template_value'] ?? [];
        $brand = trim((string)config('v2board.app_name', 'Studio'));
        if (!$brand || preg_match('/v2board/i', $brand)) $brand = 'Studio';
        $title = $copy[$type][0];
        $body = $copy[$type][1];
        $subject = $brand . ' · ' . $title;
        $content = '';
        if ($type === 'notify') {
            $variant = $params['translations'][$language] ?? [];
            $subject = $variant['subject'] ?? ($params['subject'] ?? $subject);
            $title = $subject;
            $content = $variant['content'] ?? ($value['content'] ?? '');
            $body = ''; // Custom messages already provide the introduction; avoid duplicate boilerplate.
        }
        // Notification only, including old queued jobs that still contain a reply body.
        if ($type === 'ticketReply' && (int) ($value['ticket_id'] ?? 0) > 0) {
            $content = $copy['ticketReference'].' #'.(int) $value['ticket_id'];
        }
        // Admin announcements retain basic formatting, never active content or remote tracking images.
        $html = $type === 'notify' ? $this->safeHtml($content) : nl2br(e($content));
        $url = $type === 'mailLogin' ? ($value['link'] ?? '') : ($value['url'] ?? config('v2board.app_url'));
        $routes = ['serviceActivated'=>'dashboard', 'serviceRenewed'=>'order', 'remindTraffic'=>'traffic', 'remindExpire'=>'order', 'ticketReply'=>'ticket', 'test'=>'dashboard', 'notify'=>'dashboard'];
        if (isset($routes[$type])) $url = rtrim((string)config('v2board.app_url'), '/').'/app#/'.$routes[$type];
        if (!preg_match('~^https?://~i', (string)$url)) $url = '';
        $actionKey = ['serviceRenewed'=>'billingAction', 'emailInvitation'=>'inviteAction', 'mailLogin'=>'loginAction', 'remindTraffic'=>'usageAction', 'remindExpire'=>'billingAction', 'ticketReply'=>'supportAction'][$type] ?? 'action';
        return ['language'=>$language, 'direction'=>$language === 'fa-IR' ? 'rtl' : 'ltr', 'brand'=>$brand,
            'title'=>$title, 'subject'=>str_replace(["\r", "\n"], ' ', $subject), 'body'=>$body,
            'contentHtml'=>$html, 'contentText'=>html_entity_decode(strip_tags(str_replace(['</p>','<br>','<br/>','<br />'], "\n", $html)), ENT_QUOTES, 'UTF-8'),
            'code'=>$type === 'verify' ? ($value['code'] ?? '') : '', 'url'=>$type === 'verify' ? '' : $url,
            'action'=>$copy[$actionKey], 'footer'=>$copy['footer'], 'ignore'=>$copy[$type === 'emailInvitation' ? 'ignore' : 'securityIgnore'],
            'preheader'=>mb_substr(preg_replace('/\s+/u', ' ', $body ?: html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8')), 0, 140),
            'sensitive'=>in_array($type, ['verify','mailLogin','emailInvitation'], true)];
    }
    private function safeHtml($html)
    {
        $document = new \DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8"><div>'.(string)$html.'</div>', LIBXML_NONET);
        libxml_clear_errors(); libxml_use_internal_errors($previous);
        $walk = function ($node) use (&$walk) {
            $result = '';
            foreach ($node->childNodes as $child) {
                if ($child instanceof \DOMText) { $result .= e($child->nodeValue); continue; }
                if (!($child instanceof \DOMElement)) continue;
                $tag = strtolower($child->tagName);
                if (in_array($tag, ['script','style','iframe','object','svg','math','form','input','img'], true)) continue;
                $inside = $walk($child);
                if ($tag === 'a') {
                    $href = $child->getAttribute('href');
                    $result .= preg_match('~^https?://~i', $href) ? '<a href="'.e($href).'" rel="noopener noreferrer">'.$inside.'</a>' : $inside;
                } elseif (in_array($tag, ['p','br','strong','b','em','i','ul','ol','li','blockquote','h2','h3'], true)) $result .= '<'.$tag.'>'.$inside.($tag === 'br' ? '' : '</'.$tag.'>');
                else $result .= $inside;
            }
            return $result;
        };
        return $walk($document);
    }
}
