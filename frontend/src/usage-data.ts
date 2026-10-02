export interface UsageRecord {
    record_at: number;
    u: number;
    d: number;
}
export function usageDays(
    records: UsageRecord[],
    days: "month" | "week" | "30days",
    now = new Date(),
) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    if (days !== "month") {
        start.setDate(now.getDate() - (days === "week" ? 6 : 29));
    }
    const key = (date: Date) =>
        `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const totals = new Map<string, { upload: number; download: number }>();
    for (const row of records) {
        const date = new Date(Number(row.record_at) * 1000);
        if (!Number.isFinite(date.getTime())) continue;
        const id = key(date),
            sum = totals.get(id) || { upload: 0, download: 0 };
        sum.upload += Math.max(0, Number(row.u) || 0);
        sum.download += Math.max(0, Number(row.d) || 0);
        totals.set(id, sum);
    }
    const result = [];
    for (
        const day = new Date(start);
        day <= now;
        day.setDate(day.getDate() + 1)
    ) {
        result.push({
            date: new Date(day),
            ...(totals.get(key(day)) || { upload: 0, download: 0 }),
        });
    }
    return result;
}
