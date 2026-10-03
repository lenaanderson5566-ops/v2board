<?php
namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class PlanAutoTranslation
{
    public function generate($content, $source, $target)
    {
        $url = rtrim((string) config('plan-translation.url'), '/');
        if (!$url || !config('plan-translation.key')) throw ValidationException::withMessages(['translation' => '请先配置 Azure Translator 密钥和区域']);
        $languages = ['zh-CN'=>'zh-Hans', 'zh-TW'=>'zh-Hant', 'en-US'=>'en', 'ja-JP'=>'ja', 'ko-KR'=>'ko', 'vi-VN'=>'vi', 'ru-RU'=>'ru', 'fa-IR'=>'fa'];
        if (!isset($languages[$source], $languages[$target])) throw ValidationException::withMessages(['locale'=>'语言不受支持']);
        $features = json_decode($content, true);
        if (trim($content) === '') return $content;
        $isFeatures = is_array($features) && array_keys($features) === range(0, count($features)-1);
        if ($isFeatures) foreach ($features as $item) {
            if (!is_array($item) || !isset($item['feature']) || !is_string($item['feature']) || !array_key_exists('support', $item)) {
                throw ValidationException::withMessages(['content'=>'JSON 描述必须是 feature/support 功能列表']);
            }
        }
        if ($content === '[]') return '[]';
        $texts = $isFeatures ? array_column($features, 'feature') : [$content];
        if (!$texts) return $content;
        $result = $this->translateTexts($texts, $source, $target, $isFeatures ? 'plain' : 'html');
        if (!$isFeatures) return $result[0];
        foreach ($features as $index => &$item) $item['feature'] = $result[$index];
        unset($item);
        return json_encode($features, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    public function translateTexts(array $texts, $source, $target, $format = 'plain')
    {
        $url = rtrim((string) config('plan-translation.url'), '/');
        if (!$url || !config('plan-translation.key')) throw ValidationException::withMessages(['translation'=>'请先配置 Azure Translator 密钥和区域']);
        $languages = ['zh-CN'=>'zh-Hans', 'zh-TW'=>'zh-Hant', 'en-US'=>'en', 'ja-JP'=>'ja', 'ko-KR'=>'ko', 'vi-VN'=>'vi', 'ru-RU'=>'ru', 'fa-IR'=>'fa'];
        if (!isset($languages[$source], $languages[$target])) throw ValidationException::withMessages(['locale'=>'语言不受支持']);
        if ($source === $target) return $texts;
        $headers = ['Ocp-Apim-Subscription-Key'=>config('plan-translation.key')];
        if (config('plan-translation.region')) $headers['Ocp-Apim-Subscription-Region'] = config('plan-translation.region');
        $endpoint = $url.'/translate?'.http_build_query(['api-version'=>'3.0', 'from'=>$languages[$source], 'to'=>$languages[$target], 'textType'=>$format]);
        try {
            $response = Http::withHeaders($headers)->timeout(35)->withOptions(['connect_timeout'=>5])->post($endpoint, array_map(function ($text) { return ['Text'=>$text]; }, $texts));
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            throw ValidationException::withMessages(['translation'=>'Azure 翻译服务连接超时，请稍后重试']);
        }
        if (!$response->successful()) throw ValidationException::withMessages(['translation'=>'Azure 翻译失败（HTTP '.$response->status().'），请检查密钥、区域和配额']);
        $rows = $response->json();
        if (!is_array($rows) || count($rows) !== count($texts)) throw ValidationException::withMessages(['translation'=>'Azure 返回的译文数量不正确']);
        $result = [];
        foreach ($texts as $index => $text) {
            $translated = $rows[$index]['translations'][0]['text'] ?? null;
            if (!is_string($translated) || (trim($text) !== '' && trim($translated) === '')) throw ValidationException::withMessages(['translation'=>'翻译服务返回了无效内容']);
            if ($this->numbers($text) !== $this->numbers($translated)) throw ValidationException::withMessages(['translation'=>'译文中的数字发生变化，请人工检查']);
            $result[] = $translated;
        }
        return $result;
    }
    private function numbers($text)
    {
        // Localized digits and punctuation represent the same quota, not a changed value.
        $text = strtr(html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            array_combine(preg_split('//u', '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩０１２３４５６７８９', -1, PREG_SPLIT_NO_EMPTY),
                str_split('012345678901234567890123456789')));
        $text = strtr($text, ['٫'=>'.', '٬'=>'']);
        preg_match_all('/[0-9]+(?:[.,][0-9]+)*/u', $text, $matches);
        $numbers = $matches[0];
        sort($numbers, SORT_STRING);
        return $numbers;
    }

}
