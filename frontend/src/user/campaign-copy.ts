import i18n, { type TranslationKey } from "../shared/i18n";
export const campaignCopy = (
    key: TranslationKey<"campaign">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "campaign", ...values }));
