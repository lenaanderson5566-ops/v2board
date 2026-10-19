// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
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
    await screen.findByText("暂无匹配日志");
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
it("keeps opt-in retention at zero and saves the selected duration", async () => {
    setup();
    render(<AdminLogSettings />);
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
