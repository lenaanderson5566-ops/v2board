// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminLogFilters } from "./AdminLogFilters";
afterEach(cleanup);
it("restores applied filters and preserves the failed status", () => {
    const apply = vi.fn();
    render(
        <AdminLogFilters
            kind="login"
            onApply={apply}
            initialFilters={{
                keyword: "FastAI",
                is_success: "0",
                from: 1791849600,
            }}
        />,
    );
    expect(
        (screen.getByLabelText("日志关键词") as HTMLInputElement).value,
    ).toBe("FastAI");
    fireEvent.click(screen.getByText("查询"));
    expect(apply).toHaveBeenCalledWith({
        keyword: "FastAI",
        is_success: "0",
        from: 1791849600,
    });
});
it("submits filters together, preserves failed login and resets", () => {
    const apply = vi.fn();
    render(<AdminLogFilters kind="login" onApply={apply} />);
    fireEvent.change(screen.getByLabelText("日志关键词"), {
        target: { value: " FastAI " },
    });
    fireEvent.change(screen.getByLabelText("日志登录结果"), {
        target: { value: "0" },
    });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("查询"));
    expect(apply).toHaveBeenLastCalledWith({
        keyword: "FastAI",
        is_success: "0",
    });
    fireEvent.click(screen.getByText("重置"));
    expect(apply).toHaveBeenLastCalledWith({});
});
it("rejects reversed ranges without sending a query", () => {
    const apply = vi.fn();
    render(<AdminLogFilters kind="subscribe" onApply={apply} />);
    fireEvent.change(screen.getByLabelText("日志开始时间"), {
        target: { value: "2026-10-13T12:00" },
    });
    fireEvent.change(screen.getByLabelText("日志结束时间"), {
        target: { value: "2026-10-12T12:00" },
    });
    fireEvent.click(screen.getByText("查询"));
    expect(screen.getByRole("alert").textContent).toContain(
        "结束时间不能早于开始时间",
    );
    expect(apply).not.toHaveBeenCalled();
});

it("uses the configured zone for filters without repeating it on labels", async () => {
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    const { AdminLogTimeZone, logTime } = await import("./admin-log-time");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const apply = vi.fn();
    const at = Date.parse("2026-10-19T00:00:00Z") / 1000;
    const view = render(<><AdminLogTimeZone /><AdminLogFilters kind="login" initialFilters={{from: at}} onApply={apply}/><span>{logTime(at)}</span></>);
    expect(screen.getAllByText(/Asia\/Kathmandu/)).toHaveLength(1);
    expect((screen.getByLabelText("日志开始时间") as HTMLInputElement).value).toBe("2026-10-19T05:45");
    expect(view.container.textContent).not.toMatch(/GMT|UTC/);
    fireEvent.click(screen.getByRole("button", {name:"查询"}));
    expect(apply).toHaveBeenCalledWith({from:at});
    configureTimeZone("Asia/Shanghai", true);
    setDisplayTimeZone(null);
});

it("uses one timezone hint for the workspace and formats ISO dates without a suffix", async () => {
    const { AdminTimeZoneScope, AdminLogTimeZone, adminInstant }=await import("./admin-log-time");
    const { configureTimeZone, formatInstant }=await import("../shared/timezone");
    configureTimeZone("America/New_York",true);
    const view=render(<AdminTimeZoneScope><AdminLogTimeZone/><AdminLogTimeZone/><span>{adminInstant("2026-07-01T12:00:00Z")}</span></AdminTimeZoneScope>);
    expect(screen.getAllByTestId("log-time-zone")).toHaveLength(1);
    expect(view.container.textContent).toContain("08:00:00");
    expect(view.container.textContent).not.toMatch(/GMT|EDT|EST/);
    expect(formatInstant("2026-07-01T12:00:00Z",{timeZoneName:"longOffset"})).toContain("UTC-4");
    configureTimeZone("Asia/Shanghai",true);
});
it("omits GMT in the shared user-management and online-user date renderer only in admin mode", async () => {
    window.V2BOARD ??= {mode:"admin",systemTimeZone:"Asia/Shanghai"} as typeof window.V2BOARD;
    const { boot, date }=await import("../shared/api");
    const { configureTimeZone }=await import("../shared/timezone");
    const previous=boot.mode;
    try {
        configureTimeZone("Asia/Shanghai",true);boot.mode="admin";
        expect(date(1700000000)).not.toMatch(/GMT|UTC/);
        expect(date(1700000000)).toContain("06:13:20");
        boot.mode="user";
        expect(date(1700000000)).toMatch(/GMT|UTC/);
    } finally {boot.mode=previous;}
});

it("formats ISO and numeric log timestamps through the same system-zone renderer", async () => {
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    const { logTime, adminInstant } = await import("./admin-log-time");
    configureTimeZone("America/New_York", true);
    setDisplayTimeZone("Asia/Shanghai");
    const iso = "2026-11-30T00:00:00Z";
    const seconds = Date.parse(iso) / 1000;
    expect(logTime(iso)).toBe(logTime(seconds));
    expect(logTime(String(seconds))).toBe(logTime(seconds));
    expect(logTime(new Date(iso))).toBe(logTime(seconds));
    expect(logTime(iso)).toContain("19:00:00");
    expect(logTime(iso)).not.toMatch(/GMT|UTC/);
    expect(adminInstant("2026-11-30 00:00:00")).toBe("—");
    for (const invalid of [null, undefined, "", false, {}, Infinity]) expect(logTime(invalid)).toBe("—");
    expect(logTime(0)).not.toBe("—");
    configureTimeZone("Asia/Shanghai", true);
    setDisplayTimeZone(null);
});

it("restores explicit ISO filter times in the business zone without losing seconds", async () => {
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const at = Date.parse("2026-10-19T00:00:37Z") / 1000;
    const apply = vi.fn();
    render(<AdminLogFilters kind="login" initialFilters={{ from: "2026-10-19T00:00:37Z", to: at + 60 }} onApply={apply} />);
    const from = screen.getByLabelText("日志开始时间") as HTMLInputElement;
    expect(from.value.replace(/\.0{1,3}$/, "")).toBe("2026-10-19T05:45:37");
    expect(from.step).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(apply).toHaveBeenCalledWith({ from: at, to: at + 60 });
    configureTimeZone("Asia/Shanghai", true);
    setDisplayTimeZone(null);
});
it("compares parsed instants when the range mixes minute and second precision", async () => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("UTC", true);
    const apply = vi.fn();
    render(<AdminLogFilters kind="login" onApply={apply} />);
    fireEvent.change(screen.getByLabelText("日志开始时间"), { target: { value: "2026-10-19T00:00:00" } });
    fireEvent.change(screen.getByLabelText("日志结束时间"), { target: { value: "2026-10-19T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    const at = Date.parse("2026-10-19T00:00:00Z") / 1000;
    expect(apply).toHaveBeenCalledWith({ from: at, to: at });
    configureTimeZone("Asia/Shanghai", true);
});
it("rejects ambiguous DST filter times without sending a query", async () => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    const apply = vi.fn();
    render(<AdminLogFilters kind="login" onApply={apply} />);
    fireEvent.change(screen.getByLabelText("日志开始时间"), { target: { value: "2026-11-01T01:30:37" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("夏令时重复");
    configureTimeZone("Asia/Shanghai", true);
});

it("keeps log queries in the business zone when displayed event dates use another zone", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone, formatInstant } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    setAdminDisplayTimeZone("Asia/Kathmandu");
    const at = Date.parse("2026-07-01T12:34:37Z") / 1000;
    const apply = vi.fn();
    try {
        render(<AdminLogFilters kind="login" initialFilters={{ from: at }} onApply={apply} />);
        expect(formatInstant(at)).toContain("18:19:37");
        expect((screen.getByLabelText("日志开始时间") as HTMLInputElement).value.replace(/\.0{1,3}$/, "")).toBe("2026-07-01T08:34:37");
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        expect(apply).toHaveBeenCalledWith({ from: at });
        fireEvent.change(screen.getByLabelText("日志开始时间"), { target: { value: "2026-07-01T09:34:37" } });
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        expect(apply).toHaveBeenLastCalledWith({ from: at + 3600 });
    } finally { setAdminDisplayTimeZone("business"); configureTimeZone("Asia/Shanghai", true); }
});

it("preserves both distinct applied instants inside a DST repeated hour", async () => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    const apply = vi.fn();
    const from = Date.parse("2026-11-01T05:30:00Z") / 1000;
    const to = Date.parse("2026-11-01T06:30:00Z") / 1000;
    try {
        render(<AdminLogFilters kind="login" initialFilters={{ from, to }} onApply={apply} />);
        fireEvent.change(screen.getByLabelText("日志开始时间"), { target: { value: "2026-11-01T01:30" } });
        fireEvent.change(screen.getByLabelText("日志关键词"), { target: { value: "changed" } });
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        expect(apply).toHaveBeenCalledWith({ from, to, keyword: "changed" });
    } finally { configureTimeZone("Asia/Shanghai", true); }
});
