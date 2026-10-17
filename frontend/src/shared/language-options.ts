// Stable BCP 47 code order, independent of the current UI language.
export const languages = [
    { code: "en-US", name: "English" },
    { code: "es-ES", name: "Español" },
    { code: "fa-IR", name: "فارسی" },
    { code: "ja-JP", name: "日本語" },
    { code: "ko-KR", name: "한국어" },
    { code: "pt-BR", name: "Português (Brasil)" },
    { code: "ru-RU", name: "Русский" },
    { code: "vi-VN", name: "Tiếng Việt" },
    { code: "zh-CN", name: "简体中文" },
    { code: "zh-TW", name: "繁體中文" },
] as const;
export const languageCodes = languages.map((language) => language.code);
