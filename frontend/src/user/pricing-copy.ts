import i18n, { type TranslationKey } from "../shared/i18n";
export const pricingCopy = (
    key: TranslationKey<"pricing">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "pricing", ...values }));
