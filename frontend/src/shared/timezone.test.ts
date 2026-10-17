import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./i18n", () => ({ locale: () => "en-GB", tx: (key: string) => key }));
import {
    calendarDay,
    configureTimeZone,
    dateTimeInput,
    displayTimeZone,
    formatInstant,
    parseDateTimeInput,
    setDisplayTimeZone,
} from "./timezone";
import { usageDays } from "../user/usage-data";

describe("time zone conversion", () => {
    beforeEach(() => {
        configureTimeZone("Asia/Shanghai");
        setDisplayTimeZone(null);
    });
    it.each([
        "Asia/Shanghai",
        "UTC",
        "America/New_York",
        "Asia/Kathmandu",
        "Australia/Adelaide",
    ])("round trips admin dates in %s", (zone) => {
        const at = Date.parse("2026-10-13T14:31:00Z") / 1000;
        expect(parseDateTimeInput(dateTimeInput(at, zone), zone)).toBe(at);
    });
    it("rejects nonexistent and ambiguous DST times", () => {
        expect(() =>
            parseDateTimeInput("2026-03-08T02:30", "America/New_York"),
        ).toThrow("此时间在所选时区不存在，请重新选择。");
        expect(() =>
            parseDateTimeInput("2026-11-01T01:30", "America/New_York"),
        ).toThrow("此时间因夏令时重复，请选择无歧义的时间。");
        expect(() => parseDateTimeInput("2026-02-30T12:00", "UTC")).toThrow(
            "日期时间无效",
        );
    });
    it("uses the account preference and preserves the same instant", () => {
        setDisplayTimeZone("America/New_York");
        const iso = "2026-10-13T00:00:00Z";
        expect(formatInstant(iso)).toBe(formatInstant(Date.parse(iso) / 1000));
        expect(dateTimeInput(Date.parse(iso) / 1000)).toBe("2026-10-12T20:00");
        setDisplayTimeZone(null);
        expect(displayTimeZone()).toBe(
            Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
    });
    it("keeps admin time in the business zone", () => {
        configureTimeZone("Asia/Kathmandu", true);
        setDisplayTimeZone("UTC");
        expect(dateTimeInput(0)).toBe("1970-01-01T05:30");
        expect(displayTimeZone()).toBe("Asia/Kathmandu");
    });
    it("keeps business chart dates stable across user preferences and DST", () => {
        configureTimeZone("America/New_York");
        const now = new Date("2026-03-09T04:30:00Z");
        const records = [
            {
                record_at: Date.parse("2026-03-08T05:00:00Z") / 1000,
                u: 2,
                d: 3,
            },
        ];
        const a = usageDays(records, "week", now);
        setDisplayTimeZone("Asia/Tokyo");
        expect(usageDays(records, "week", now)).toEqual(a);
        expect(a).toHaveLength(7);
        expect(a[5]).toMatchObject({ upload: 2, download: 3 });
        expect(calendarDay(now)).toBe("2026-03-09");
    });
});
