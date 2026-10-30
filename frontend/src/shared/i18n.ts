import { localPreferences, sessionPreferences } from "./browser-storage";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import startupCatalogs from "virtual:startup-catalogs";

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
type EnglishCatalog = typeof import("../locales/en-US.json");
export type TranslationNamespace = keyof EnglishCatalog;
export type TranslationKey<N extends TranslationNamespace> =
    keyof EnglishCatalog[N];
type Catalog = Record<string, Record<string, string>>;
const localeLoaders: Record<string, () => Promise<{ default: Catalog }>> = {
    "zh-CN": () => import("../locales/zh-CN.json"),
    "en-US": () => import("../locales/en-US.json"),
    "zh-TW": () => import("../locales/zh-TW.json"),
    "ja-JP": () => import("../locales/ja-JP.json"),
    "ko-KR": () => import("../locales/ko-KR.json"),
    "vi-VN": () => import("../locales/vi-VN.json"),
    "ru-RU": () => import("../locales/ru-RU.json"),
    "fa-IR": () => import("../locales/fa-IR.json"),
    "es-ES": () => import("../locales/es-ES.json"),
    "pt-BR": () => import("../locales/pt-BR.json"),
    "fr-FR": () => import("../locales/fr-FR.json"),
    "de-DE": () => import("../locales/de-DE.json"),
    "id-ID": () => import("../locales/id-ID.json"),
    "th-TH": () => import("../locales/th-TH.json"),
};
const completeCatalogs = new Set<string>();
const catalogRequests = new Map<string, Promise<Catalog>>();
let workspaceLanguage = window.V2BOARD?.mode === "admin";
async function loadCatalog(language: string): Promise<Catalog> {
    let pending = catalogRequests.get(language);
    if (!pending) {
        pending = localeLoaders[language]().then(({ default: catalog }) => {
            for (const [namespace, values] of Object.entries(catalog))
                i18next.addResourceBundle(language, namespace, values, true, true);
            completeCatalogs.add(language);
            return catalog;
        }).catch(error => { catalogRequests.delete(language); throw error; });
        catalogRequests.set(language, pending);
    }
    return pending;
}
export const hasCompleteCatalog = (language: string) => completeCatalogs.has(language);
// The guide uses only a source-derived microcatalog. Business screens load the
// current complete language, without downloading another complete fallback.
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
        if (!localeLoaders[language] || (language === "en-US" && i18next.language !== "en-US" && !completeCatalogs.has(language))) {
            callback(null, startupCatalogs[language]?.[namespace] || {});
            return;
        }
        loadCatalog(language).then(
            (catalog) => callback(null, catalog[namespace] || {}),
            (error: Error) => callback(error, null),
        );
    },
});
const saved = localPreferences.getItem(languageKey);
const initialLanguage =
    window.V2BOARD?.mode === "admin" ? "zh-CN"
        : saved && languages.some((l) => l.code === saved) ? saved
            : resolvePreferredLanguage([...(navigator.languages || []), navigator.language || "en-US"]);
const initialLanguageReady = i18next.use(initReactI18next).init({
    partialBundledLanguages: true,
    resources: startupCatalogs,
    lng: initialLanguage,
    supportedLngs: languages.map((l) => l.code),
    fallbackLng: "en-US",
    load: "currentOnly",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false }, // React escapes text; translations never render as HTML.
    returnEmptyString: false,
    initAsync: false,
});
export const languageReady = initialLanguageReady.then(async value => {
    if (window.V2BOARD?.mode === "admin") await loadCatalog("zh-CN");
    return value;
});
const changeInstanceLanguage = i18next.changeLanguage.bind(i18next);
// Preserve the public instance method's complete-catalog behavior for existing
// callers. The entry's language picker uses the core-only helper below.
i18next.changeLanguage = async (value, callback) => {
    const target = value
        ? i18next.services.languageUtils.getBestMatchFromCodes([value]) || "en-US"
        : locale();
    try {
        await loadCatalog(target);
        workspaceLanguage = true;
        return await changeInstanceLanguage(value, callback);
    } catch (error) {
        callback?.(error, i18next.t.bind(i18next));
        throw error;
    }
};
export async function prepareWorkspaceLanguage() {
    await languageReady;
    await loadCatalog(locale());
    workspaceLanguage = true;
}
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
            sessionPreferences.getItem(pendingLanguageKey) === locale(),
    };
}
async function ensureCatalog(value: string) {
    if (!completeCatalogs.has(value) && localeLoaders[value]) {
        await loadCatalog(value);
    }
}
export async function applyAccountLanguage(value: unknown) {
    sessionPreferences.removeItem(pendingLanguageKey);
    if (typeof value !== "string" || !languages.some((l) => l.code === value))
        return;
    await ensureCatalog(value);
    localPreferences.setItem(languageKey, value);
    workspaceLanguage = true;
    await changeInstanceLanguage(value);
}
export async function changeLanguage(value: string) {
    if (!languages.some((l) => l.code === value)) return;
    // Do not change the saved preference if the language chunk cannot be downloaded.
    if (workspaceLanguage) await ensureCatalog(value);
    // Save first: a failed request leaves the previous preference intact.
    const savedToAccount = persistLanguage
        ? await persistLanguage(value)
        : false;
    if (savedToAccount) sessionPreferences.removeItem(pendingLanguageKey);
    else sessionPreferences.setItem(pendingLanguageKey, value);
    localPreferences.setItem(languageKey, value);
    await changeInstanceLanguage(value);
}
export default i18next;
