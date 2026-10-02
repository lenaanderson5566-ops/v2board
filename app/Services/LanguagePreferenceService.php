<?php
namespace App\Services;

class LanguagePreferenceService
{
    public const SUPPORTED = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN', 'ru-RU', 'fa-IR'];
    public static function rule(): string { return 'sometimes|required|string|in:' . implode(',', self::SUPPORTED); }
}
