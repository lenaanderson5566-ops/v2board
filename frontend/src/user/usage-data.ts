import { calendarDay, validZone } from "../shared/timezone";
export interface UsageRecord {
    record_at: number;
    business_date?: string;
    record_timezone?: string;
    u: number;
    d: number;
}
/** A daily total belongs to its recorded business day, not an event instant. */
export function usageRecordDay(row: { record_at?: unknown; business_date?: unknown; record_timezone?: unknown }): string | null {
    const timestamp = row.record_at;
    if ((typeof timestamp !== "number" && typeof timestamp !== "string")
        || (typeof timestamp === "string" && timestamp.trim() === "")) return null;
    const at = new Date(Number(timestamp) * 1000);
    if (!Number.isFinite(at.getTime())) return null;
    const day = row.business_date;
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        const date = new Date(`${day}T00:00:00Z`);
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day) return day;
    }
    return calendarDay(at, typeof row.record_timezone === "string" && validZone(row.record_timezone) ? row.record_timezone : undefined);
}
export function usageDays(
    records: UsageRecord[],
    days: "month" | "week" | "30days",
    now = new Date(),
) {
    now = new Date(calendarDay(now) + "T00:00:00Z");
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    if (days !== "month") {
        start.setUTCDate(now.getUTCDate() - (days === "week" ? 6 : 29));
    }
    const key = (date: Date) => date.toISOString().slice(0, 10);
    const totals = new Map<string, { upload: number; download: number }>();
    for (const row of records) {
        const id = usageRecordDay(row);
        if (!id) continue;
        const sum = totals.get(id) || { upload: 0, download: 0 };
        sum.upload += Math.max(0, Number(row.u) || 0);
        sum.download += Math.max(0, Number(row.d) || 0);
        totals.set(id, sum);
    }
    const result = [];
    for (
        const day = new Date(start);
        day <= now;
        day.setUTCDate(day.getUTCDate() + 1)
    ) {
        result.push({
            date: new Date(day),
            ...(totals.get(key(day)) || { upload: 0, download: 0 }),
        });
    }
    return result;
}
