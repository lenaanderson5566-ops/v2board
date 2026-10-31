import { createContext, useContext, type ReactNode } from "react";
import { businessTimeZone, displayTimeZone, formatInstant } from "../shared/timezone";

export const adminInstant = (value: unknown, options: Intl.DateTimeFormatOptions = {}) => formatInstant(value, {...options, timeZoneName: undefined});
export const adminBusinessInstant = (value: unknown, options: Intl.DateTimeFormatOptions = {}, zone = businessTimeZone()) => formatInstant(value, {...options, timeZoneName: undefined}, zone);
const TimeZoneShown = createContext(false);
export function AdminTimeZoneScope({children}: {children:ReactNode}) {
    return <><AdminLogTimeZone /><TimeZoneShown.Provider value={true}>{children}</TimeZoneShown.Provider></>;
}

/** Display only: exports must continue using their timezone-aware serialization. */
export const logTime = (value: unknown) => adminInstant(value);

export function AdminBusinessTimeZoneNote() {
    return <p className="admin-log-note muted">日期输入使用业务时区：{businessTimeZone()}</p>;
}

export function AdminLogTimeZone() {
    const shown=useContext(TimeZoneShown);
    if(shown)return null;
    const display = displayTimeZone(), business = businessTimeZone();
    return <p className="admin-log-note muted" data-testid="log-time-zone">
        界面显示时区：{display} · 日期输入与筛选按业务时区：{business}
    </p>;
}
