import { locale, tx } from "./i18n";

let preference: string | null = null;
let systemZone = "Asia/Shanghai";
let administrator = false;
export function validZone(zone: string): boolean {
    try {
        new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
        return true;
    } catch {
        return false;
    }
}
export function configureTimeZone(system: string, admin = false) {
    systemZone = validZone(system) ? system : "UTC";
    administrator = admin;
}
export function setDisplayTimeZone(value: unknown) {
    preference = typeof value === "string" && validZone(value) ? value : null;
}
export function businessTimeZone() {
    return systemZone;
}
export function displayTimeZone() {
    return administrator
        ? systemZone
        : preference ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC";
}
/** Offset at the represented instant, including daylight-saving transitions. */
export function utcOffsetLabel(
    value: Date | string | number,
    zone = displayTimeZone(),
): string {
    const date = value instanceof Date
        ? value : new Date(typeof value === "number" ? value * 1000 : value);
    if (!Number.isFinite(date.getTime()) || !validZone(zone)) return "—";
    const name = new Intl.DateTimeFormat("en", {
        timeZone: zone, timeZoneName: "longOffset",
    }).formatToParts(date).find(part => part.type === "timeZoneName")?.value;
    return name === "GMT" ? "UTC+00:00" : name?.replace(/^GMT/, "UTC") || "—";
}
export function formatInstant(
    value: Date | string | number,
    options: Intl.DateTimeFormatOptions = {},
    zone = displayTimeZone(),
): string {
    const date =
        value instanceof Date
            ? value
            : new Date(typeof value === "number" ? value * 1000 : value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
        ...options,
        timeZone: zone,
    }).format(date);
}
export function calendarDay(value: Date, zone = businessTimeZone()): string {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
}
export function dateTimeInput(
    seconds: number,
    zone = displayTimeZone(),
): string {
    if (!Number.isFinite(seconds)) return "";
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(seconds * 1000));
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function parseDateTimeInput(
    value: string,
    zone = displayTimeZone(),
): number {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
        throw new Error(tx("日期时间格式无效"));
    const wall = Date.parse(value + ":00Z");
    if (
        !Number.isFinite(wall) ||
        new Date(wall).toISOString().slice(0, 16) !== value
    )
        throw new Error(tx("日期时间无效"));
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 3) {
        const at = wall + hours * 3600000;
        offsets.add(Date.parse(dateTimeInput(at / 1000, zone) + ":00Z") - at);
    }
    const candidates = [...offsets]
        .map((offset) => (wall - offset) / 1000)
        .filter((at) => dateTimeInput(at, zone) === value);
    if (candidates.length !== 1)
        throw new Error(
            tx(
                candidates.length
                    ? "此时间因夏令时重复，请选择无歧义的时间。"
                    : "此时间在所选时区不存在，请重新选择。",
            ),
        );
    return candidates[0];
}
