import { calendarDay } from "../shared/timezone";
export interface UsageRecord {
    record_at: number;
    business_date?: string;
    record_timezone?: string;
    u: number;
    d: number;
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
        const date = new Date(Number(row.record_at) * 1000);
        if (!Number.isFinite(date.getTime())) continue;
        const id = row.business_date || calendarDay(date),
            sum = totals.get(id) || { upload: 0, download: 0 };
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
