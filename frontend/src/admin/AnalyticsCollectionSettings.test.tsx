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
import { AnalyticsCollectionSettings } from "./AnalyticsCollectionSettings";
import { Settings } from "./admin-settings";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("reads and saves collection settings through the dedicated configuration endpoint", async () => {
    api.request.mockResolvedValue({
        data: { ready: true, settings: { enabled: false, retentionDays: 30 } },
    });
    render(<AnalyticsCollectionSettings />);
    fireEvent.click(await screen.findByLabelText("开启访问统计"));
    fireEvent.change(screen.getByLabelText("保留时间"), {
        target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/analytics/settings",
            { enabled: true, retentionDays: 7 },
        ),
    );
    expect(
        api.request.mock.calls.every(
            ([path]) => path === "test-admin/analytics/settings",
        ),
    ).toBe(true);
});
it("disables collection edits before migrations and exposes read failures", async () => {
    api.request.mockResolvedValue({
        data: { ready: false, settings: { enabled: false, retentionDays: 30 } },
    });
    const view = render(<AnalyticsCollectionSettings />);
    expect(
        ((await screen.findByLabelText("开启访问统计")) as HTMLInputElement)
            .disabled,
    ).toBe(true);
    view.unmount();
    api.request.mockRejectedValue(new Error("读取失败"));
    render(<AnalyticsCollectionSettings />);
    expect(await screen.findByText("读取失败")).toBeTruthy();
});
it("moves browser policies to a separate settings tab without changing saved keys", async () => {
    api.request.mockImplementation(async (path: string) => ({
        data: path.endsWith("config/fetch")
            ? {
                  site: {},
                  safe: {
                      browser_policy_wechat: "guide",
                      register_limit_by_ip_enable: 0,
                  },
              }
            : {},
    }));
    render(<Settings />);
    fireEvent.click(await screen.findByRole("button", { name: "安全与注册" }));
    await screen.findByText("保存");
    expect(screen.queryByText("微信访问策略")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "浏览器访问" }));
    const policy = await screen.findByLabelText(/微信访问策略/);
    fireEvent.change(policy, { target: { value: "prompt" } });
    expect(screen.getByText("当前策略：提示后允许访问")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith("test-admin/config/save", {
            browser_policy_wechat: "prompt",
        }),
    );
});
