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
    it("includes seven complete days across a month boundary and excludes future records", () => {
        expect(usageDays([], "week", now)).toHaveLength(7);
        expect(usageDays([], "week", new Date(2026, 9, 2, 12))).toHaveLength(7);
        const days = usageDays([record(15, 9, 9)], "month", now);
        expect(days.every((day) => day.upload + day.download === 0)).toBe(true);
    });
    it("includes exactly thirty days across month and year boundaries", () => {
        const end = new Date(2026, 0, 2, 12);
        const previous = new Date(2025, 11, 10);
        const days = usageDays(
            [{ record_at: previous.getTime() / 1000, u: 4, d: 8 }],
            "30days",
            end,
        );
        expect(days).toHaveLength(30);
        expect(days[0].date).toEqual(new Date(2025, 11, 4));
        expect(
            days.find((day) => day.date.getTime() === previous.getTime()),
        ).toMatchObject({ upload: 4, download: 8 });
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
