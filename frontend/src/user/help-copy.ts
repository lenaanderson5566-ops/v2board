import i18n, { type TranslationKey } from "../shared/i18n";
export type HelpCopy = Record<TranslationKey<"help">, string>;
export const h = (
    key: TranslationKey<"help">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "help", ...values }));
