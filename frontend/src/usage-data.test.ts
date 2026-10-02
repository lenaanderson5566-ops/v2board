import { describe, expect, it } from "vitest";
import { usageDays } from "./usage-data";
const now = new Date(2026, 9, 12, 12);
const record = (day: number, u: number, d: number) => ({
    record_at: new Date(2026, 9, day).getTime() / 1000,
    u,
    d,
});
describe("daily usage series", () => {
    it("sums records for the same day without applying billing multipliers", () => {
        const days = usageDays(
            [record(2, 10, 20), record(2, 5, 4)],
            "month",
            now,
        );
        expect(days).toHaveLength(12);
        expect(days[1]).toMatchObject({ upload: 15, download: 24 });
        expect(days[0]).toMatchObject({ upload: 0, download: 0 });
    });
    it("limits seven days to the available month and excludes future records", () => {
        expect(usageDays([], "week", now)).toHaveLength(7);
        expect(usageDays([], "week", new Date(2026, 9, 2, 12))).toHaveLength(2);
        const days = usageDays([record(15, 9, 9)], "month", now);
        expect(days.every((day) => day.upload + day.download === 0)).toBe(true);
    });
    it("ignores invalid dates and clamps negative counters", () => {
        const days = usageDays(
            [record(1, -2, 4), { record_at: NaN, u: 1, d: 1 }],
            "month",
            now,
        );
        expect(days[0]).toMatchObject({ upload: 0, download: 4 });
    });
});
