import { formatInstant, utcOffsetLabel } from "./timezone";
import i18n, { type TranslationKey } from "./i18n";
export const c = (
    key: TranslationKey<"credits">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "credits", ...values }));
export function minuteDate(value: unknown, _timezone?: string): string {
    if (!value || !Number.isFinite(Number(value))) return "—";
    const at = Number(value);
    const text = formatInstant(at, { second: undefined, timeZoneName: undefined });
    return text === "—" ? text : `${text} ${utcOffsetLabel(at)}`;
}
