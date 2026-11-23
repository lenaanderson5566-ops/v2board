import { createContext, useContext, type ReactNode } from "react";
import { businessTimeZone, displayTimeZone, formatInstant, instantDate, utcOffsetLabel } from "../shared/timezone";

export const adminInstant = (value: unknown, options: Intl.DateTimeFormatOptions = {}) => formatInstant(value, {...options, timeZoneName: undefined});
export const adminBusinessInstant = (value: unknown, options: Intl.DateTimeFormatOptions = {}, zone = businessTimeZone()) => formatInstant(value, {...options, timeZoneName: undefined}, zone);
const TimeZoneShown = createContext(false);
export function AdminTimeZoneScope({ children, logFilters }: { children: ReactNode; logFilters?: boolean }) {
    return <><AdminLogTimeZone logFilters={logFilters} /><TimeZoneShown.Provider value={true}>{children}</TimeZoneShown.Provider></>;
}

/** Display only: exports must continue using their timezone-aware serialization. */
export const logTime = (value: unknown) => adminInstant(value);

export function AdminLogTimestamp({ value, description }: { value: unknown; description?: string }) {
    const instant = instantDate(value);
    if (!instant) return "—";
    const display = displayTimeZone();
    const offset = utcOffsetLabel(instant, display);
    const details = [`显示时区 ${display}${display === offset ? "" : ` · ${offset}`}`];
    if (description) details.push(description);
    return <time dateTime={instant.toISOString()} title={details.join("\n")}>{logTime(instant)}</time>;
}

export function AdminBusinessTimeZoneNote({ zone = businessTimeZone() }: { zone?: string }) {
    return <p className="admin-log-note muted">日期输入使用业务时区：{zone}</p>;
}

export function AdminLogTimeZone({ logFilters = false }: { logFilters?: boolean }) {
    if (useContext(TimeZoneShown)) return null;
    return <p className="admin-log-note muted" data-testid="log-time-zone">
        {logFilters
            ? `日志时间与筛选时区：${displayTimeZone()}`
            : `界面显示时区：${displayTimeZone()} · 系统业务时区：${businessTimeZone()}`}
    </p>;
}
