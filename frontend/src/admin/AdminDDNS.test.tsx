// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    act,
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
import { AdminDDNS } from "./AdminDDNS";
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});
function setup() {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("ddns/fetch"))
            return {
                data: {
                    credentials: [
                        {
                            id: 1,
                            name: "Zone",
                            zone_id: "a".repeat(32),
                            status: "ready",
                        },
                    ],
                    assignments: [
                        {
                            id: 2,
                            credential_id: 1,
                            node_type: "v2node",
                            node_id: 3,
                            domain: "node.example.com",
                            family: "ipv4",
                            enabled: true,
                            status: "healthy",
                        },
                    ],
                },
            };
        if (path.includes("ddns/events")) return { data: [], total: 0 };
        if (path.endsWith("getNodes"))
            return { data: [{ id: 3, type: "v2node", name: "Node" }] };
        if (path.endsWith("assignments/rotate"))
            return { data: { reportToken: "b".repeat(64), family: "ipv4" } };
        return { data: { id: 1 } };
    });
}
it("does not populate stored tokens and preserves blank credential edits", async () => {
    setup();
    render(<AdminDDNS />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    expect((screen.getByLabelText("API Token") as HTMLInputElement).value).toBe(
        "",
    );
    fireEvent.change(screen.getByLabelText("名称"), {
        target: { value: "Renamed zone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/ddns/credentials/save",
            {
                id: 1,
                name: "Renamed zone",
                zone_id: "a".repeat(32),
                token: undefined,
                root_domain: undefined,
            },
        ),
    );
});
it("reveals only scoped key after explicit rotation, without putting it in shell history", async () => {
    setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminDDNS />);
    fireEvent.click(
        await screen.findByRole("button", { name: "配置节点上报" }),
    );
    const key = await screen.findByLabelText("独立上报密钥");
    expect((key as HTMLInputElement).value).toBe("b".repeat(64));
    const command = (
        screen.getByLabelText("IP 上报配置命令") as HTMLTextAreaElement
    ).value;
    expect(command).toContain("report-configure --family ipv4");
    expect(command).not.toContain("b".repeat(64));
});

import { NodeDomainBinding, NodeDomainTools } from "./NodeDomains";
function managedSetup(transitionState = "none") {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("ddns/fetch"))
            return {
                data: {
                    credentials: [{ id: 1, root_domain: "example.com" }],
                    assignments: [
                        {
                            id: 2,
                            credential_id: 1,
                            node_type: "v2box",
                            node_id: 3,
                            domain: "hk.example.com",
                            published_domain: "old.example.com",
                            family: "ipv4",
                            managed: true,
                            enabled: true,
                            status: "ready_to_switch",
                            tls_transition_state: transitionState,
                        },
                    ],
                },
            };
        return { data: true };
    });
}
it("refreshes address reports only while visible and stops after unmount", async () => {
    managedSetup();
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => {
        view = render(
            <NodeDomainBinding
                node={{ id: 3, type: "v2box", current_ip: "8.8.8.8" }}
            />,
        );
    });
    expect(screen.getByText(/IPv4 上报：尚未收到/)).toBeTruthy();
    expect(screen.queryByText(/IPv4 上报：8.8.8.8/)).toBeNull();
    const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
    const calls = api.request.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(api.request).toHaveBeenCalledTimes(calls);
    visibility.mockReturnValue("visible");
    api.request.mockResolvedValue({
        data: {
            credentials: [{ id: 1, root_domain: "example.com" }],
            assignments: [
                {
                    id: 2,
                    credential_id: 1,
                    node_type: "v2box",
                    node_id: 3,
                    domain: "hk.example.com",
                    enabled: true,
                    family: "ipv4",
                    status: "healthy",
                    ipv4: "8.8.8.8",
                    ipv4_seen_at: Math.floor(Date.now() / 1000),
                    last_success: Math.floor(Date.now() / 1000),
                },
            ],
        },
    });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByText(/IPv4 上报：8.8.8.8/)).toBeTruthy();
    expect(screen.queryByText(/尚未收到独立 IP 上报/)).toBeNull();
    expect(api.request).toHaveBeenCalledTimes(calls + 1);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(api.request).toHaveBeenCalledTimes(calls + 1);
});
it("preserves edits, avoids concurrent polling and stops polling on an API error", async () => {
    managedSetup();
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
        render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    });
    fireEvent.change(screen.getByLabelText("子域名前缀"), {
        target: { value: "unsaved" },
    });
    let reject!: (error: Error) => void;
    api.request.mockImplementation(
        () =>
            new Promise((_, fail) => {
                reject = fail;
            }),
    );
    const calls = api.request.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(api.request).toHaveBeenCalledTimes(calls + 1);
    await act(async () => reject(new Error("状态读取失败")));
    expect(screen.getByRole("alert").textContent).toContain("状态读取失败");
    expect(screen.getByLabelText("子域名前缀")).toHaveProperty(
        "value",
        "unsaved",
    );
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(api.request).toHaveBeenCalledTimes(calls + 1);
});
it("saves a root and prefix without prematurely activating a node address", async () => {
    managedSetup();
    render(
        <NodeDomainBinding
            node={{ id: 3, type: "v2box", host: "old.example.com" }}
        />,
    );
    await screen.findByText("目标域名：hk.example.com");
    fireEvent.change(screen.getByLabelText("子域名前缀"), {
        target: { value: "jp-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存域名" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/domains/bind",
            {
                node_type: "v2box",
                node_id: 3,
                credential_id: 1,
                prefix: "jp-01",
                family: "ipv4",
            },
        ),
    );
    expect(
        api.request.mock.calls.some(([p]) => p.endsWith("domains/activate")),
    ).toBe(false);
});
it("requires explicit confirmation before activating prepared DNS", async () => {
    managedSetup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    fireEvent.click(
        await screen.findByRole("button", { name: "验证并启用域名" }),
    );
    expect(
        api.request.mock.calls.some(([p]) => p.endsWith("domains/activate")),
    ).toBe(false);
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "验证并启用域名" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/domains/activate",
            { id: 2, confirm: true },
        ),
    );
});
it("requires a migration preview and sends its proof when confirming", async () => {
    api.request
        .mockResolvedValueOnce({
            data: {
                rows: [{ node_id: 3, old: "hk.a.test", new: "hk.b.test" }],
                proof: "p".repeat(64),
            },
        })
        .mockResolvedValueOnce({ data: { queued: true } });
    render(
        <NodeDomainTools
            credentials={[
                { id: 1, root_domain: "a.test" },
                { id: 2, root_domain: "b.test" },
            ]}
            onChanged={() => {}}
        />,
    );
    expect(screen.queryByRole("button", { name: "确认准备新域名" })).toBeNull();
    fireEvent.change(screen.getByLabelText("原根域名"), {
        target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("新根域名"), {
        target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览域名迁移" }));
    fireEvent.click(
        await screen.findByRole("button", { name: "确认准备新域名" }),
    );
    await waitFor(() =>
        expect(api.request).toHaveBeenLastCalledWith(
            "test-admin/server/domains/migrate",
            { from: 1, to: 2, proof: "p".repeat(64) },
        ),
    );
});
it("historical cleanup offers deletion only for reviewed unreferenced candidates", async () => {
    api.request.mockResolvedValue({
        data: {
            rows: [
                {
                    domain: "used.a.test",
                    type: "A",
                    content: "8.8.8.8",
                    inUse: true,
                },
                {
                    domain: "old.a.test",
                    type: "A",
                    content: "1.1.1.1",
                    cleanupToken: "x".repeat(48),
                },
            ],
            pages: 1,
        },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
        <NodeDomainTools
            credentials={[{ id: 1, root_domain: "a.test" }]}
            onChanged={() => {}}
        />,
    );
    fireEvent.change(screen.getByLabelText("原根域名"), {
        target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查历史解析" }));
    expect(
        await screen.findAllByRole("button", { name: "删除此解析" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "删除此解析" }));
    expect(
        api.request.mock.calls.some(([p]) => p.endsWith("remove-historical")),
    ).toBe(false);
});

it("shows pending certificate verification without offering another activation", async () => {
    managedSetup("pending");
    render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    await screen.findByText("正在验证证书与节点就绪状态，当前地址继续保留");
    expect(screen.queryByRole("button", { name: "验证并启用域名" })).toBeNull();
    expect(screen.getByText(/当前地址：old.example.com/)).toBeTruthy();
});
it("keeps the published address visible and allows retry after certificate failure", async () => {
    managedSetup("failed");
    render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    await screen.findByText("切换未完成，已保留原配置。请检查节点日志后重试");
    expect(screen.getByRole("button", { name: "验证并启用域名" })).toBeTruthy();
    expect(screen.getByText(/当前地址：old.example.com/)).toBeTruthy();
});

it("configures reporting from the domain drawer using a one-use command and expires it", async () => {
    managedSetup();
    vi.useFakeTimers();
    await act(async () => {
        render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    });
    fireEvent.click(
        screen.getByRole("button", { name: "配置 / 修复 IP 上报" }),
    );
    expect(screen.queryByLabelText("独立上报密钥")).toBeNull();
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (path: string, body: any) =>
        path.endsWith("credentials/deployment")
            ? {
                  data: {
                      command: "one-use-network-command",
                      expiresAt: new Date(Date.now() + 600000).toISOString(),
                  },
              }
            : original(path, body),
    );
    await act(async () => {
        fireEvent.click(
            screen.getByRole("button", { name: "生成上报配置命令" }),
        );
    });
    expect(api.request).toHaveBeenCalledWith(
        "test-admin/server/credentials/deployment",
        { type: "v2box", id: 3, networkOnly: true },
    );
    expect(screen.getByLabelText("IP 上报一键配置命令")).toHaveProperty(
        "value",
        "one-use-network-command",
    );
    await act(() => vi.advanceTimersByTimeAsync(600001));
    expect(screen.queryByLabelText("IP 上报一键配置命令")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("命令已过期");
});
