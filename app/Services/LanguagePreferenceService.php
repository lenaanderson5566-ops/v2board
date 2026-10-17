<?php
namespace App\Services;

class LanguagePreferenceService
{
    public const SUPPORTED = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN', 'ru-RU', 'fa-IR', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'id-ID', 'th-TH'];
    public static function rule(): string { return 'sometimes|required|string|in:' . implode(',', self::SUPPORTED); }
}
