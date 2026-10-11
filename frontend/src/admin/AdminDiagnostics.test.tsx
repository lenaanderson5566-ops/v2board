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
import { NodeDiagnostics, SystemHealth } from "./AdminDiagnostics";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
            phpVersion: "8.4",
            frameworkVersion: "13",
            checkedAt: 123,
        },
    });
    render(<SystemHealth />);
    expect(await screen.findByText("请运行 update.sh")).toBeTruthy();
    expect(screen.getByText("连接正常")).toBeTruthy();
    expect(screen.getByText("未执行迁移：2 项")).toBeTruthy();
    expect(screen.getByText(/只读检查/)).toBeTruthy();
});
