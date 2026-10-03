<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\PlanAutoTranslation;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
class ContentTranslationController extends Controller
{
    public function generate(Request $request)
    {
        $languages = 'in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR';
        $data = $request->validate([
            'source'=>'required|'.$languages, 'locale'=>'required|'.$languages,
            'subject'=>'required|string|max:200', 'content'=>'required|string|max:20000',
            'format'=>'required|in:html,plain',
        ]);
        $service = new PlanAutoTranslation();
        $texts = [$data['format'] === 'html' ? e($data['subject']) : $data['subject'], $data['content']];
        [$subject, $content] = $service->translateTexts($texts, $data['source'], $data['locale'], $data['format']);
        if ($data['format'] === 'html') $subject = html_entity_decode(strip_tags($subject), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // Never silently alter action links or Markdown destinations in a translation.
        preg_match_all('~https?://[^\s<>"\)]+~u', html_entity_decode($data['content'], ENT_QUOTES | ENT_HTML5, 'UTF-8'), $before);
        preg_match_all('~https?://[^\s<>"\)]+~u', html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8'), $after);
        sort($before[0]); sort($after[0]);
        if ($before[0] !== $after[0]) throw ValidationException::withMessages(['translation'=>'译文中的链接发生变化，请人工检查']);
        if (mb_strlen($subject) > 200) throw ValidationException::withMessages(['translation'=>'译文标题过长，请缩短原文后重试']);
        return response(['data'=>['subject'=>$subject, 'content'=>$content]]);
    }
}
