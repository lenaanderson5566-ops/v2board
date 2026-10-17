import i18n, { type TranslationKey } from "./i18n";
export const ac = (
    key: TranslationKey<"account">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "account", ...values }));
