import { locale, tx } from "./i18n";

let preference: string | null = null;
let systemZone = "Asia/Shanghai";
let administrator = false;
const listeners = new Set<() => void>();
/** Subscribe to effective display-zone changes without fetching account data again. */
export function subscribeTimeZone(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function notifyTimeZone(previous: string) {
    if (previous !== displayTimeZone()) for (const listener of listeners) listener();
}
export function validZone(zone: string): boolean {
    try {
        new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
        return true;
    } catch {
        return false;
    }
}
export function configureTimeZone(system: string, admin = false) {
    const previous = displayTimeZone();
    systemZone = validZone(system) ? system : "UTC";
    administrator = admin;
    notifyTimeZone(previous);
}
export function setDisplayTimeZone(value: unknown) {
    const previous = displayTimeZone();
    preference = typeof value === "string" && validZone(value) ? value : null;
    notifyTimeZone(previous);
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
/** Accept event instants only; never interpret a missing value or a naive wall clock. */
export function instantDate(value: unknown): Date | null {
    let date: Date;
    if (value instanceof Date) date = value;
    else if (typeof value === "number") date = new Date(value * 1000);
    else if (typeof value === "string") {
        const text = value.trim();
        if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) date = new Date(Number(text) * 1000);
        else {
            const iso = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i);
            if (!iso) return null;
            const wall = `${iso[1]}T${iso[2]}:${iso[3]}:${iso[4] || "00"}`;
            const checked = new Date(`${wall}Z`);
            const offset = iso[5];
            if (!Number.isFinite(checked.getTime()) || checked.toISOString().slice(0, 19) !== wall
                || (offset.toUpperCase() !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))) return null;
            date = new Date(text);
        }
    } else return null;
    return Number.isFinite(date.getTime()) ? date : null;
}

/** Offset at the represented instant, including daylight-saving transitions. */
export function utcOffsetLabel(
    value: unknown,
    zone = displayTimeZone(),
): string {
    const date = instantDate(value);
    if (!date || !validZone(zone)) return "—";
    const name = new Intl.DateTimeFormat("en", {
        timeZone: zone, timeZoneName: "longOffset",
    }).formatToParts(date).find(part => part.type === "timeZoneName")?.value;
    if (name === "GMT") return "UTC";
    const offset = name?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (offset && Number(offset[2]) === 0 && (!offset[3] || offset[3] === "00")) return "UTC";
    return offset ? `UTC${offset[1]}${Number(offset[2])}${offset[3] && offset[3] !== "00" ? `:${offset[3]}` : ""}` : "—";
}
export function formatInstant(
    value: unknown,
    options: Intl.DateTimeFormatOptions = {},
    zone = displayTimeZone(),
): string {
    const date = instantDate(value);
    if (!date || !validZone(zone)) return "—";
    const showZone = !Object.hasOwn(options, "timeZoneName") || options.timeZoneName !== undefined;
    const text = new Intl.DateTimeFormat(locale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        ...options,
        timeZoneName: undefined,
        timeZone: zone,
    }).format(date);
    return showZone ? `${text} (${utcOffsetLabel(date, zone)})` : text;
}
export function calendarDay(value: Date, zone = businessTimeZone()): string {
    if (!instantDate(value) || !validZone(zone)) return "";
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
    precision: "minute" | "second" = "minute",
): string {
    const date = instantDate(seconds);
    if (!date || !validZone(zone) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return "";
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        second: precision === "second" ? "2-digit" : undefined,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}${precision === "second" ? `:${get("second")}` : ""}`;
}
export function parseDateTimeInput(
    value: string,
    zone = displayTimeZone(),
): number {
    // datetime-local controls may serialize whole seconds with zero milliseconds.
    value = value.replace(/\.0{1,3}$/, "");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value) || !validZone(zone))
        throw new Error(tx("日期时间格式无效"));
    const precision = value.length === 19 ? "second" : "minute";
    const wallDate = instantDate(`${value}${precision === "minute" ? ":00" : ""}Z`);
    if (!wallDate) throw new Error(tx("日期时间无效"));
    const wall = wallDate.getTime();
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 3) {
        const at = wall + hours * 3600000;
        offsets.add(Date.parse(dateTimeInput(at / 1000, zone, "second") + "Z") - at);
    }
    const candidates = [...offsets]
        .map((offset) => (wall - offset) / 1000)
        .filter((at) => dateTimeInput(at, zone, precision) === value);
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
