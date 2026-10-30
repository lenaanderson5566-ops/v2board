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
    utcOffsetLabel,
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
    it("labels UTC offsets at the represented reset date, including DST and quarter hours", () => {
        const summer = "2026-07-01T12:00:00Z";
        const winter = "2026-01-01T12:00:00Z";
        expect(utcOffsetLabel(summer, "UTC")).toBe("UTC+00:00");
        expect(utcOffsetLabel(summer, "Asia/Shanghai")).toBe("UTC+08:00");
        expect(utcOffsetLabel(summer, "Asia/Kathmandu")).toBe("UTC+05:45");
        expect(utcOffsetLabel(summer, "America/New_York")).toBe("UTC-04:00");
        expect(utcOffsetLabel(winter, "America/New_York")).toBe("UTC-05:00");
        setDisplayTimeZone("Asia/Kathmandu");
        expect(utcOffsetLabel(Date.parse(summer) / 1000)).toBe("UTC+05:45");
        expect(utcOffsetLabel(new Date(winter), "America/New_York")).toBe("UTC-05:00");
        expect(utcOffsetLabel("invalid", "UTC")).toBe("—");
        expect(utcOffsetLabel(summer, "invalid")).toBe("—");
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

it("removes only the timezone suffix for log display and preserves explicit formatting", async () => {
    const { logTime } = await import("../admin/admin-log-time");
    configureTimeZone("America/New_York", true);
    const summer = Date.parse("2026-07-01T12:00:00Z") / 1000;
    const winter = Date.parse("2026-01-01T12:00:00Z") / 1000;
    expect(logTime(summer)).toContain("08:00:00");
    expect(logTime(winter)).toContain("07:00:00");
    expect(logTime(summer)).not.toMatch(/GMT|UTC|EDT|EST/);
    expect(formatInstant(summer, {timeZoneName:"longOffset"})).toContain("GMT-04:00");
    expect(formatInstant(winter, {timeZoneName:"longOffset"})).toContain("GMT-05:00");
    expect(logTime(null)).toBe("—");
    expect(logTime("")).toBe("—");
    expect(logTime("invalid")).toBe("—");
    expect(logTime(0)).not.toBe("—");
});
