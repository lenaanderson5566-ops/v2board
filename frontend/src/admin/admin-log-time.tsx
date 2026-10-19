import { createContext, useContext, type ReactNode } from "react";
import { displayTimeZone, formatInstant } from "../shared/timezone";

export const adminInstant = (value: Date | string | number, options: Intl.DateTimeFormatOptions = {}) => formatInstant(value, {...options, timeZoneName: undefined});
const TimeZoneShown = createContext(false);
export function AdminTimeZoneScope({children}: {children:ReactNode}) {
    return <><AdminLogTimeZone /><TimeZoneShown.Provider value={true}>{children}</TimeZoneShown.Provider></>;
}

/** Display only: exports must continue using their timezone-aware serialization. */
export const logTime = (value: unknown) =>
    value != null && value !== "" ? formatInstant(Number(value), { timeZoneName: undefined }) : "—";

export function AdminLogTimeZone() {
    const shown=useContext(TimeZoneShown);
    if(shown)return null;
    return <p className="admin-log-note muted" data-testid="log-time-zone">时间显示与筛选时区：{displayTimeZone()}</p>;
}
