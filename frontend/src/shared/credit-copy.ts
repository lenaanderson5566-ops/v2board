import { displayTimeZone, formatInstant, validZone } from "./timezone";
import i18n, { type TranslationKey } from "./i18n";
export const c = (
    key: TranslationKey<"credits">,
    values?: Record<string, unknown>,
): string => String(i18n.t(key, { ns: "credits", ...values }));
export function minuteDate(value: unknown, explicitZone?: string): string {
    if (!value || !Number.isFinite(Number(value))) return "—";
    const at = Number(value);
    const zone = explicitZone ?? displayTimeZone();
    if (!validZone(zone)) return "—";
    return formatInstant(at, { second: undefined }, zone);
}
