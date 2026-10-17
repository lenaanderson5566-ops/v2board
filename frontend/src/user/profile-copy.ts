import i18n, { type TranslationKey } from "../shared/i18n";
export const p = (
    key: TranslationKey<"profile">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "profile", ...values }));
