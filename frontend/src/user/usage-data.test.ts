vi.mock("../shared/i18n", () => ({ locale: () => "en-GB" }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTimeZone } from "../shared/timezone";
beforeEach(() => configureTimeZone("UTC"));
import { usageDays } from "./usage-data";
const now = new Date(Date.UTC(2026, 9, 12, 12));
const record = (day: number, u: number, d: number) => ({
    record_at: new Date(Date.UTC(2026, 9, day)).getTime() / 1000,
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
        expect(
            usageDays([], "week", new Date(Date.UTC(2026, 9, 2, 12))),
        ).toHaveLength(7);
        const days = usageDays([record(15, 9, 9)], "month", now);
        expect(days.every((day) => day.upload + day.download === 0)).toBe(true);
    });
    it("includes exactly thirty days across month and year boundaries", () => {
        const end = new Date(Date.UTC(2026, 0, 2, 12));
        const previous = new Date(Date.UTC(2025, 11, 10));
        const days = usageDays(
            [{ record_at: previous.getTime() / 1000, u: 4, d: 8 }],
            "30days",
            end,
        );
        expect(days).toHaveLength(30);
        expect(days[0].date).toEqual(new Date(Date.UTC(2025, 11, 4)));
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

it("keeps the original business date when the system zone changes", () => {
    configureTimeZone("America/New_York");
    const days = usageDays(
        [
            {
                record_at: Date.parse("2026-10-01T16:00:00Z") / 1000,
                business_date: "2026-10-02",
                record_timezone: "Asia/Shanghai",
                u: 3,
                d: 4,
            },
        ],
        "month",
        new Date("2026-10-03T12:00:00Z"),
    );
    expect(days[1]).toMatchObject({ upload: 3, download: 4 });
    expect(days[0]).toMatchObject({ upload: 0, download: 0 });
});
