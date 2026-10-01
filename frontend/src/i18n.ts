import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";
import koKR from "./locales/ko-KR.json";
import viVN from "./locales/vi-VN.json";
import ruRU from "./locales/ru-RU.json";
import faIR from "./locales/fa-IR.json";

export const languages = [
    { code: "zh-CN", name: "简体中文" },
    { code: "zh-TW", name: "繁體中文" },
    { code: "en-US", name: "English" },
    { code: "ja-JP", name: "日本語" },
    { code: "ko-KR", name: "한국어" },
    { code: "vi-VN", name: "Tiếng Việt" },
    { code: "ru-RU", name: "Русский" },
    { code: "fa-IR", name: "فارسی" },
] as const;
export const languageKey = "v2board.language";
export function resolveLanguage(value: string): string {
    if (/^zh(-|$)/i.test(value))
        return /TW|HK|MO|Hant/i.test(value) ? "zh-TW" : "zh-CN";
    const base = value.toLowerCase().split("-")[0];
    const matched = languages.find(
        (l) => l.code.toLowerCase().split("-")[0] === base,
    );
    if (matched) return matched.code;
    return "en-US";
}
const saved = localStorage.getItem(languageKey);
void i18next.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "zh-TW": { translation: zhTW },
        "en-US": { translation: enUS },
        "ja-JP": { translation: jaJP },
        "ko-KR": { translation: koKR },
        "vi-VN": { translation: viVN },
        "ru-RU": { translation: ruRU },
        "fa-IR": { translation: faIR },
    },
    lng:
        window.V2BOARD?.mode === "admin"
            ? "zh-CN"
            : saved && languages.some((l) => l.code === saved)
              ? saved
              : resolveLanguage(navigator.language || "en-US"),
    supportedLngs: languages.map((l) => l.code),
    fallbackLng: "en-US",
    load: "currentOnly",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false }, // React escapes text; translations never render as HTML.
    returnEmptyString: false,
    initAsync: false,
});
function syncLanguage() {
    document.documentElement.lang = i18next.language;
    document.documentElement.dir = i18next.dir();
}
i18next.on("languageChanged", syncLanguage);
syncLanguage();
export const locale = () =>
    i18next.resolvedLanguage || i18next.language || "en-US";
export const tx = (key: string, values?: Record<string, unknown>): string =>
    String(i18next.t(key, values || {}));
export async function changeLanguage(value: string) {
    if (!languages.some((l) => l.code === value)) return;
    localStorage.setItem(languageKey, value);
    await i18next.changeLanguage(value);
}
export default i18next;
