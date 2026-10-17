import i18n, { type TranslationKey } from "./i18n";
export const ux = (
    key: TranslationKey<"ux">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "ux", ...values }));
