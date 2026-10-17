import i18n, { type TranslationKey } from "../shared/i18n";
export const a = (
    key: TranslationKey<"announcements">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "announcements", ...values }));
