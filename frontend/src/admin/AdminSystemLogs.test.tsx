// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import { AdminLogSettings } from "./AdminLogSettings";
import { AdminSystemLogs } from "./AdminSystemLogs";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
const settings = {
    mail_log_retention_days: 0,
    client_diagnostic_retention_days: 30,
    registration_signal_retention_days: 90,
    payment_callback_retention_days: 30,
    connection_log_interval: 3600,
    system_log_retention_days: 30,
    connection_log_retention_days: 30,
    login_log_retention_days: 0,
    subscribe_log_retention_days: 0,
    risk_log_retention_days: 0,
    ddns_log_retention_days: 30,
};
function setup() {
    api.request.mockImplementation(async (path: string, body?: unknown) =>
        path.endsWith("logRetention")
            ? { data: body ? settings : { settings, lastRun: null } }
            : path.endsWith("analytics/settings") ? {data:{ready:true,settings:{enabled:false,retentionDays:30}}} : { data: [], total: 0 },
    );
}
it("submits exact filters and resets pagination", async () => {
    setup();
    render(<AdminSystemLogs />);
    expect((await screen.findByText("暂无匹配日志")).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("region", { name: "数据表格" })).toBeNull();
    const initialReads = api.request.mock.calls.length;
    fireEvent.change(screen.getByLabelText("日志请求 ID"), { target: { value: "incomplete" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(screen.getByRole("alert").textContent).toContain("完整的 UUID");
    expect(document.activeElement).toBe(screen.getByLabelText("日志请求 ID"));
    expect(api.request.mock.calls).toHaveLength(initialReads);
    fireEvent.change(screen.getByLabelText("日志级别"), {
        target: { value: "ERROR" },
    });
    fireEvent.change(screen.getByLabelText("日志状态码"), {
        target: { value: "503" },
    });
    fireEvent.change(screen.getByLabelText("日志请求 ID"), {
        target: { value: "120ab398-35a2-4bc2-b25f-7fa362114e02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
        expect(
            api.request.mock.calls.some(
                ([path]) =>
                    path.includes("level=ERROR") &&
                    path.includes("status=503") &&
                    path.includes(
                        "request_id=120ab398-35a2-4bc2-b25f-7fa362114e02",
                    ) &&
                    path.includes("current=1"),
            ),
        ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/system/getSystemLog?current=1&page_size=20",
            undefined,
            expect.anything(),
        ),
    );
});
it("rejects reversed time bounds before querying", async () => {
    setup();
    render(<AdminSystemLogs />);
    await screen.findByText("暂无匹配日志");
    fireEvent.change(screen.getByLabelText("日志开始时间"), {
        target: { value: "2026-10-11T10:00" },
    });
    fireEvent.change(screen.getByLabelText("日志结束时间"), {
        target: { value: "2026-10-10T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(screen.getByText("结束时间不能早于开始时间")).toBeTruthy();
});
it("redisplays the applied range and unsubmitted dates across UTC and Shanghai without another request", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone } = await import("../shared/timezone");
    const now = Date.parse("2026-11-02T05:30:37Z");
    const expectedFrom = now / 1000 - 86400;
    const expectedTo = Date.parse("2026-11-01T07:45:19Z") / 1000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    configureTimeZone("Asia/Kathmandu", true);
    setAdminDisplayTimeZone("UTC");
    try {
        api.request.mockResolvedValue({ data: [{ id: 1, created_at: expectedFrom, level: "INFO", title: "entry" }], total: 1 });
        render(<AdminSystemLogs />);
        await screen.findByRole("cell", { name: /05:30:37/ });
        const from = screen.getByLabelText("日志开始时间") as HTMLInputElement;
        const to = screen.getByLabelText("日志结束时间") as HTMLInputElement;
        const wall = (field: HTMLInputElement) => field.value.replace(/\.0{1,3}$/, "");
        const request = () => new URLSearchParams(String(api.request.mock.calls.at(-1)?.[0]).split("?")[1]);
        const initialReads = api.request.mock.calls.length;
        expect(request().get("from")).toBe(String(expectedFrom));
        expect(wall(from)).toBe("2026-11-01T05:30:37");
        fireEvent.change(to, { target: { value: "2026-11-01T07:45:19" } });

        act(() => setAdminDisplayTimeZone("Asia/Shanghai"));
        expect(screen.getByTestId("log-time-zone").textContent).toContain("Asia/Shanghai");
        expect(wall(from)).toBe("2026-11-01T13:30:37");
        expect(wall(to)).toBe("2026-11-01T15:45:19");
        expect(screen.getByText(/13:30:37 至 现在/)).toBeTruthy();
        const rowTime = screen.getByRole("cell", { name: /13:30:37/ }).querySelector("time");
        expect(rowTime?.dateTime).toBe(new Date(expectedFrom * 1000).toISOString());
        expect(rowTime?.title).toContain("UTC+8");
        expect(api.request.mock.calls).toHaveLength(initialReads);
        expect(request().has("to")).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        await waitFor(() => expect(request().get("to")).toBe(String(expectedTo)));
        expect(request().get("from")).toBe(String(expectedFrom));
        const appliedReads = api.request.mock.calls.length;
        act(() => setAdminDisplayTimeZone("UTC"));
        expect(wall(to)).toBe("2026-11-01T07:45:19");
        expect(screen.getByText(/05:30:37 至 .*07:45:19/)).toBeTruthy();
        expect(api.request.mock.calls).toHaveLength(appliedReads);
    } finally {
        clock.mockRestore();
        setAdminDisplayTimeZone("business");
        configureTimeZone("Asia/Shanghai", true);
    }
});
it("retains the precise rolling lower bound during a repeated display-zone hour", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("UTC", true);
    setAdminDisplayTimeZone("America/New_York");
    const now = Date.parse("2026-11-02T06:30:37Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
        setup();
        render(<AdminSystemLogs />);
        await screen.findByText("暂无匹配日志");
        const from = screen.getByLabelText("日志开始时间") as HTMLInputElement;
        expect(from.value.replace(/\.0{1,3}$/, "")).toBe("2026-11-01T01:30:37");
        fireEvent.change(screen.getByLabelText("日志级别"), { target: { value: "ERROR" } });
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        await waitFor(() => expect(api.request.mock.calls.at(-1)?.[0]).toContain("level=ERROR"));
        const query = new URLSearchParams(String(api.request.mock.calls.at(-1)?.[0]).split("?")[1]);
        expect(query.get("from")).toBe(String(now / 1000 - 86400));
    } finally {
        clock.mockRestore();
        setAdminDisplayTimeZone("business");
        configureTimeZone("Asia/Shanghai", true);
    }
});
it("keeps opt-in retention at zero and saves the selected duration", async () => {
    setup();
    render(<AdminLogSettings route="log-settings" />);
    const field = await screen.findByLabelText(/登录日志保留天数/);
    expect((field as HTMLInputElement).value).toBe("0");
    fireEvent.change(field, { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText(/连接日志采样间隔/), { target: { value: "1800" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/system/logRetention",
            expect.objectContaining({
                connection_log_interval: 1800,
                login_log_retention_days: 90,
                subscribe_log_retention_days: 0,
                risk_log_retention_days: 0,
            }),
        ),
    );
});

it("renders log timestamps without a repeated zone suffix", async () => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Shanghai", true);
    api.request.mockResolvedValue({data:[{id:1,created_at:1792368000,level:"INFO",title:"test"}],total:1});
    render(<AdminSystemLogs />);
    const cell = await screen.findByRole("cell", {name:/08:00:00/});
    expect(cell.textContent).not.toMatch(/GMT|UTC/);
    expect(screen.getAllByText(/Asia\/Shanghai/)).toHaveLength(1);
});

it("loads only the accepted log category and marks a dirty draft for the route guard", async () => {
    history.replaceState(null, "", "#/log-settings");
    setup();
    const view = render(<AdminLogSettings route="log-settings" />);
    const field = await screen.findByLabelText(/登录日志保留天数/);
    expect(api.request.mock.calls.some(([path]) => path.includes("analytics/settings"))).toBe(false);
    fireEvent.change(field, {target: {value: "90"}});
    expect(field.closest('[data-unsaved="true"]')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", {name: "访问统计"}), {button: 0, ctrlKey: false});
    expect(location.hash).toBe("#/log-settings?tab=analytics");
    expect((field as HTMLInputElement).value).toBe("90");
    expect(api.request.mock.calls.some(([path]) => path.includes("analytics/settings"))).toBe(false);

    view.rerender(<AdminLogSettings route="log-settings?tab=analytics" />);
    expect(await screen.findByLabelText("开启访问统计")).toBeTruthy();
    expect(screen.queryByLabelText(/登录日志保留天数/)).toBeNull();

    view.rerender(<AdminLogSettings route="log-settings" />);
    const restored = await screen.findByLabelText(/登录日志保留天数/);
    expect((restored as HTMLInputElement).value).toBe("0");
    expect(restored.closest('[data-unsaved="true"]')).toBeNull();
});
