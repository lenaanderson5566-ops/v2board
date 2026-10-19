import { displayTimeZone, formatInstant } from "../shared/timezone";

/** Display only: exports must continue using their timezone-aware serialization. */
export const logTime = (value: unknown) =>
    value != null && value !== "" ? formatInstant(Number(value), { timeZoneName: undefined }) : "—";

export function AdminLogTimeZone() {
    return <p className="admin-log-note muted" data-testid="log-time-zone">时间显示与筛选时区：{displayTimeZone()}</p>;
}
