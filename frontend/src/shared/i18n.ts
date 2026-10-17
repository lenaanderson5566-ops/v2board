import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "../locales/zh-CN.json";
import enUS from "../locales/en-US.json";

import { languages } from "./language-options";
export { languages } from "./language-options";
export const languageKey = "v2board.language";
function matchLanguage(value: string): string | undefined {
    if (/^zh(-|$)/i.test(value))
        return /TW|HK|MO|Hant/i.test(value) ? "zh-TW" : "zh-CN";
    const base = value.toLowerCase().split("-")[0];
    const matched = languages.find(
        (l) => l.code.toLowerCase().split("-")[0] === base,
    );
    if (matched) return matched.code;
    return undefined;
}
export function resolvePreferredLanguage(values: readonly string[]): string {
    for (const value of values) {
        const matched = matchLanguage(value);
        if (matched) return matched;
    }
    return "en-US";
}
export type TranslationNamespace = keyof typeof enUS;
export type TranslationKey<N extends TranslationNamespace> =
    keyof (typeof enUS)[N];
type Catalog = Record<string, Record<string, string>>;
const localeLoaders: Record<string, () => Promise<{ default: Catalog }>> = {
    "zh-TW": () => import("../locales/zh-TW.json"),
    "ja-JP": () => import("../locales/ja-JP.json"),
    "ko-KR": () => import("../locales/ko-KR.json"),
    "vi-VN": () => import("../locales/vi-VN.json"),
    "ru-RU": () => import("../locales/ru-RU.json"),
    "fa-IR": () => import("../locales/fa-IR.json"),
    "es-ES": () => import("../locales/es-ES.json"),
    "pt-BR": () => import("../locales/pt-BR.json"),
};
async function loadCatalog(language: string): Promise<Catalog> {
    const { default: catalog } = await localeLoaders[language]();
    for (const [namespace, values] of Object.entries(catalog))
        i18next.addResourceBundle(language, namespace, values, true, true);
    return catalog;
}
// One resource per language: common languages are bundled, others load on demand.
i18next.use({
    type: "backend",
    init() {},
    read(
        language: string,
        namespace: string,
        callback: (
            error: Error | null,
            data: Record<string, string> | null,
        ) => void,
    ) {
        if (!localeLoaders[language]) {
            callback(null, {});
            return;
        }
        loadCatalog(language).then(
            (catalog) => callback(null, catalog[namespace] || {}),
            (error: Error) => callback(error, null),
        );
    },
});
const saved = localStorage.getItem(languageKey);
export const languageReady = i18next.use(initReactI18next).init({
    partialBundledLanguages: true,
    resources: {
        "zh-CN": zhCN,
        "en-US": enUS,
    },
    lng:
        window.V2BOARD?.mode === "admin"
            ? "zh-CN"
            : saved && languages.some((l) => l.code === saved)
              ? saved
              : resolvePreferredLanguage([
                    ...(navigator.languages || []),
                    navigator.language || "en-US",
                ]),
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
export function setLanguagePersistence(
    save: (value: string) => Promise<boolean>,
) {
    persistLanguage = save;
}
export function loginLanguagePreference() {
    return {
        language: locale(),
        language_selected:
            sessionStorage.getItem(pendingLanguageKey) === locale(),
    };
}
async function ensureCatalog(value: string) {
    if (
        !i18next.hasResourceBundle(value, "translation") &&
        localeLoaders[value]
    ) {
        await loadCatalog(value);
    }
}
export async function applyAccountLanguage(value: unknown) {
    sessionStorage.removeItem(pendingLanguageKey);
    if (typeof value !== "string" || !languages.some((l) => l.code === value))
        return;
    await ensureCatalog(value);
    localStorage.setItem(languageKey, value);
    await i18next.changeLanguage(value);
}
export async function changeLanguage(value: string) {
    if (!languages.some((l) => l.code === value)) return;
    // Do not change the saved preference if the language chunk cannot be downloaded.
    await ensureCatalog(value);
    // Save first: a failed request leaves the previous preference intact.
    const savedToAccount = persistLanguage
        ? await persistLanguage(value)
        : false;
    if (savedToAccount) sessionStorage.removeItem(pendingLanguageKey);
    else sessionStorage.setItem(pendingLanguageKey, value);
    localStorage.setItem(languageKey, value);
    await i18next.changeLanguage(value);
}
export default i18next;
