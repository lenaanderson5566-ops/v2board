import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "../locales/zh-CN.json";
import enUS from "../locales/en-US.json";

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
const localeLoaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
    "zh-TW": () => import("../locales/zh-TW.json"),
    "ja-JP": () => import("../locales/ja-JP.json"),
    "ko-KR": () => import("../locales/ko-KR.json"),
    "vi-VN": () => import("../locales/vi-VN.json"),
    "ru-RU": () => import("../locales/ru-RU.json"),
    "fa-IR": () => import("../locales/fa-IR.json"),
};
// Keep common/fallback languages available synchronously; fetch other catalogs only when needed.
i18next.use({
    type: "backend",
    init() {},
    read(language: string, namespace: string, callback: (error: Error | null, data: Record<string, string> | null) => void) {
        const loader = namespace === "translation" ? localeLoaders[language] : undefined;
        if (!loader) { callback(null, {}); return; }
        loader().then(({ default: catalog }) => callback(null, catalog), (error: Error) => callback(error, null));
    },
});
const saved = localStorage.getItem(languageKey);
export const languageReady = i18next.use(initReactI18next).init({
    partialBundledLanguages: true,
    resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
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
const pendingLanguageKey = `${languageKey}.pending`;
let persistLanguage: ((value: string) => Promise<boolean>) | undefined;
export function setLanguagePersistence(save: (value: string) => Promise<boolean>) {
    persistLanguage = save;
}
export function loginLanguagePreference() {
    return { language: locale(), language_selected: sessionStorage.getItem(pendingLanguageKey) === locale() };
}
async function ensureCatalog(value: string) {
    if (!i18next.hasResourceBundle(value, "translation") && localeLoaders[value]) {
        const { default: catalog } = await localeLoaders[value]();
        i18next.addResourceBundle(value, "translation", catalog, true, true);
    }
}
export async function applyAccountLanguage(value: unknown) {
    sessionStorage.removeItem(pendingLanguageKey);
    if (typeof value !== "string" || !languages.some((l) => l.code === value)) return;
    await ensureCatalog(value);
    localStorage.setItem(languageKey, value);
    await i18next.changeLanguage(value);
}
export async function changeLanguage(value: string) {
    if (!languages.some((l) => l.code === value)) return;
    // Do not change the saved preference if the language chunk cannot be downloaded.
    await ensureCatalog(value);
    // Save first: a failed request leaves the previous preference intact.
    const savedToAccount = persistLanguage ? await persistLanguage(value) : false;
    if (savedToAccount) sessionStorage.removeItem(pendingLanguageKey);
    else sessionStorage.setItem(pendingLanguageKey, value);
    localStorage.setItem(languageKey, value);
    await i18next.changeLanguage(value);
}
export default i18next;
