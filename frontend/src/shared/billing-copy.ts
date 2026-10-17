import i18n, { type TranslationKey } from "./i18n";
export const b = (
    key: TranslationKey<"billing">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "billing", ...values }));
