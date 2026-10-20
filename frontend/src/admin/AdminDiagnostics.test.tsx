// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import { NodeDiagnostics } from "./AdminDiagnostics";
import { AdminObservability } from "./AdminObservability";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("shows stale monitoring without reporting healthy and saves backend-only thresholds", async () => {
    const settings = {
        sample_percent: 10,
        slow_request_ms: 2000,
        slow_query_ms: 200,
        error_percent: 5,
        slow_percent: 20,
        min_samples: 20,
        queue_length: 100,
        queue_wait_seconds: 60,
        failed_jobs: 1,
    };
    api.request.mockResolvedValue({
        data: {
            stale: true,
            snapshot: null,
            alerts: [],
            settings,
            metrics: {
                total: {
                    samples: 0,
                    errors: 0,
                    slowRequests: 0,
                    slowQueries: 0,
                },
                routes: [],
                dropped: 0,
            },
        },
    });
    render(<AdminObservability />);
    expect(await screen.findByText(/等待监控任务首次运行/)).toBeTruthy();
    expect(screen.queryByText("暂无告警")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "监控设置" }));
    fireEvent.change(screen.getByLabelText("请求采样比例（%）"), {
        target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText(/监控设置已保存/)).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith(
        "test-admin/system/observability/settings",
        { ...settings, sample_percent: 0 },
    );
});
it("distinguishes provided configuration from application confirmation", async () => {
    api.request.mockResolvedValue({
        data: {
            configurationState: "provided",
            providedAt: 123,
            applicationState: "unconfirmed",
            inheritedFrom: 7,
        },
    });
    render(
        <NodeDiagnostics
            node={{
                id: 8,
                type: "v2box",
                name: "Child",
                runtime_status: "online",
            }}
            close={() => {}}
        />,
    );
    expect(await screen.findByText(/已提供最新配置，待应用确认/)).toBeTruthy();
    expect(screen.getByText(/子节点沿用父节点 #7/)).toBeTruthy();
    expect(screen.getByText(/没有应用回执/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新配置状态" }));
    expect(api.request.mock.calls[0][0]).toBe(
        "test-admin/server/manage/runtime?type=v2box&id=8",
    );
});
it("shows failing health checks alongside healthy components", async () => {
    api.request.mockResolvedValue({
        data: {
            stale: false,
            settings: { sample_percent: 10 },
            metrics: { total: { samples: 0 }, routes: [] },
            snapshot: {
                checkedAt: 123,
                queue: { available: false },
                health: {
                    checks: [
                        {
                            key: "database",
                            label: "数据库",
                            status: "healthy",
                            message: "连接正常",
                        },
                        {
                            key: "migrations",
                            label: "数据库迁移",
                            status: "warning",
                            message: "请运行 update.sh",
                            pendingCount: 2,
                        },
                    ],
                },
            },
        },
    });
    render(<AdminObservability />);
    expect(await screen.findByText("请运行 update.sh")).toBeTruthy();
    expect(screen.getByText("连接正常")).toBeTruthy();
    expect(screen.getByText("未执行迁移：2 项")).toBeTruthy();
    expect(screen.getByText("队列数据暂不可用")).toBeTruthy();
});
