import { displayTimeZone } from "./timezone";
import i18n, { type TranslationKey, locale } from "./i18n";
export const c = (
    key: TranslationKey<"credits">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "credits", ...values }));
export function minuteDate(value: unknown, _timezone?: string): string {
    if (!value || !Number.isFinite(Number(value))) return "—";
    return new Intl.DateTimeFormat(locale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: displayTimeZone(),
        timeZoneName: "short",
    }).format(new Date(Number(value) * 1000));
}
