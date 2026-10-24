// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
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
it("keeps DNS inventory read-only and directs configuration to its owning pages", async () => {
    setup();
    render(<AdminDDNS />);
    expect(
        (await screen.findAllByText("node.example.com")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("节点绑定")).toBeNull();
    for (const name of ["配置节点域名", "配置节点上报", "编辑 / 恢复"])
        expect(screen.queryByRole("button", { name })).toBeNull();
    expect(
        screen.getByRole("link", { name: "节点管理" }).getAttribute("href"),
    ).toBe("#/nodes");
    expect(
        screen.getAllByRole("link", { name: "服务器管理" }).every(link=>link.getAttribute("href")==="#/servers"),
    ).toBe(true);
    expect(
        api.request.mock.calls.some(([path]) =>
            String(path).includes("getNodes"),
        ),
    ).toBe(false);
});

import { NodeDomainBinding, NodeDomainTools } from "./NodeDomains";
function managedSetup(
    transitionState = "none",
    overrides: Record<string, unknown> = {},
) {
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
                            published_port:443,
                            family: "ipv4",
                            managed: true,
                            enabled: true,
                            status: "ready_to_switch",
                            tls_transition_state: transitionState,
                            ipv4: "8.8.8.8",
                            ipv4_seen_at: Math.floor(Date.now() / 1000),
                            last_success: Math.floor(Date.now() / 1000),
                            certificate_transition_supported: true,
                            ...overrides,
                        },
                    ],
                },
            };
        return { data: true };
    });
}
it("refreshes address reports only while visible and stops after unmount", async () => {
    managedSetup("none", { ipv4: null, ipv4_seen_at: 0 });
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
    fireEvent.click(screen.getByText("修改域名设置"));
    fireEvent.click(screen.getByRole("button", { name: "保存域名" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/domains/bind",
            {
                node_type: "v2box",
                node_id: 3,
                credential_id: 1,
                prefix: "jp-01",
                server_id: null,
                entry_id: null,
                entry_port: null,
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
        await screen.findByRole("button", { name: "验证并切换地址" }),
    );
    expect(
        api.request.mock.calls.some(([p]) => p.endsWith("domains/activate")),
    ).toBe(false);
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "验证并切换地址" }));
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
    await screen.findByText("正在验证新域名");
    expect(screen.queryByRole("button", { name: "验证并切换地址" })).toBeNull();
    expect(screen.getByText(/当前生效域名：old.example.com/)).toBeTruthy();
});
it("keeps the published address visible and allows retry after certificate failure", async () => {
    managedSetup("failed");
    render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    await screen.findByText("下一步：检查日志后重新验证");
    expect(screen.getByRole("button", { name: "验证并切换地址" })).toBeTruthy();
    expect(screen.getByText(/当前生效域名：old.example.com/)).toBeTruthy();
});

it("configures reporting from advanced maintenance using a one-use command and expires it", async () => {
    managedSetup("none", { ipv4: null, ipv4_seen_at: 0 });
    vi.useFakeTimers();
    await act(async () => {
        render(<NodeDomainBinding node={{ id: 3, type: "v2box" }} />);
    });
    fireEvent.click(screen.getByText("高级维护"));
    fireEvent.click(screen.getByRole("button", { name: "修复 IP 上报" }));
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

it("explains the next step and gates ordinary TLS activation on node capability", async () => {
    managedSetup("none", { certificate_transition_supported: false });
    const view = render(
        <NodeDomainBinding node={{ id: 3, type: "v2box", tls: 1 }} />,
    );
    await screen.findByText("下一步：升级 V2Box");
    expect(screen.queryByRole("button", { name: "验证并切换地址" })).toBeNull();
    view.unmount();
    managedSetup();
    render(<NodeDomainBinding node={{ id: 3, type: "v2box", tls: 1 }} />);
    await screen.findByText("下一步：验证并切换地址");
    expect(screen.getByRole("button", { name: "验证并切换地址" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试 DNS 同步" })).toBeNull();
});
it("waits for both address families and does not allow stale DNS activation", async () => {
    managedSetup("none", { family: "dual", ipv6: null, ipv6_seen_at: 0 });
    const view = render(
        <NodeDomainBinding node={{ id: 3, type: "v2box", tls: 2 }} />,
    );
    await screen.findByText("下一步：检查 IP 上报");
    expect(screen.queryByRole("button", { name: "验证并切换地址" })).toBeNull();
    expect(
        (
            screen.getByRole("button", {
                name: "重试 DNS 同步",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    view.unmount();
    managedSetup("none", { last_success: 1 });
    render(<NodeDomainBinding node={{ id: 3, type: "v2box", tls: 2 }} />);
    await screen.findByText("下一步：等待解析同步");
    expect(screen.queryByRole("button", { name: "验证并切换地址" })).toBeNull();
});
it("distinguishes a read-only refresh from queued DNS synchronization", async () => {
    managedSetup("none", { status: "network_error", last_success: 1 });
    render(<NodeDomainBinding node={{ id: 3, type: "v2box", tls: 1 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "刷新状态" }));
    await waitFor(() =>
        expect(
            api.request.mock.calls.filter(([path]) =>
                String(path).endsWith("ddns/fetch"),
            ).length,
        ).toBeGreaterThan(1),
    );
    expect(
        api.request.mock.calls.some(([path]) =>
            /domains\/(retry|activate)$/.test(String(path)),
        ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "重试 DNS 同步" }));
    await screen.findByText(/已安排 DNS 同步，将由下一轮后台调度执行/);
    expect(api.request).toHaveBeenCalledWith(
        "test-admin/server/domains/retry",
        { id: 2 },
    );
    expect(
        api.request.mock.calls.some(([path]) =>
            String(path).endsWith("domains/activate"),
        ),
    ).toBe(false);
});
it("notifies the list once when polling observes publication, without publishing early", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    managedSetup("pending");
    const onPublished = vi.fn();
    await act(async () => {
        render(
            <NodeDomainBinding
                node={{ id: 3, type: "v2box", host: "old.example.com", port:443, tls: 1 }}
                onPublished={onPublished}
            />,
        );
    });
    expect(onPublished).not.toHaveBeenCalled();
    managedSetup("applied", {
        published_domain: "hk.example.com",
        status: "healthy",
    });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByText("新域名已生效")).toBeTruthy();
    expect(screen.getByText(/当前生效域名：hk.example.com/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "验证并切换地址" })).toBeNull();
    expect(onPublished).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(onPublished).toHaveBeenCalledTimes(1);
});

it.each([
    ["healthy", "none", {}, false],
    ["new", "none", { ipv4: null, ipv4_seen_at: 0 }, true],
    ["pending", "pending", { ipv4: null, ipv4_seen_at: 0 }, false],
])(
    "does not offer redundant reporting repair for %s nodes",
    async (_, transition, overrides, fresh) => {
        managedSetup(
            transition as string,
            overrides as Record<string, unknown>,
        );
        render(
            <NodeDomainBinding node={{ id: 3, type: "v2box", _new: fresh }} />,
        );
        await screen.findByText(/目标域名：/);
        expect(screen.queryByText("高级维护")).toBeNull();
        expect(
            screen.queryByRole("button", { name: "修复 IP 上报" }),
        ).toBeNull();
    },
);

import { NetworkServers } from "./NetworkServers";
import { nodeDomainProgress } from "./node-domain-progress";
it("generates a physical server enrollment without a node ID", async () => {
    api.request.mockResolvedValue({
        data: {
            command:
                "sh install-v2box.sh --server-id 10 --deploy-token ns_test",
        },
    });
    render(
        <NetworkServers
            reload={vi.fn()}
            data={{
                servers: [
                    { id: 10, name: "入口一", family: "ipv4", enabled: true },
                ],
                assignments: [],
                credentials: [],
            }}
        />,
    );
    expect(screen.queryByRole("button", { name: "配置服务器上报" })).toBeNull();
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "管理" })).toHaveProperty(
            "disabled",
            false,
        ),
    );
    await waitFor(()=>expect(screen.getByRole("button",{name:"管理"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    await waitFor(() =>
        expect(
            screen.getByRole("button", { name: "配置服务器上报" }),
        ).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "配置服务器上报" }));
    await screen.findByText(/sh install-v2box.sh --server-id 10/);
    expect(api.request).toHaveBeenCalledWith(
        "test-admin/server/network/enroll",
        { id: 10 },
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存服务器配置" })).toBeTruthy();
});
it("submits separate origin server and shared entry settings", async () => {
    api.request.mockResolvedValue({
        data: {
            credentials: [{ id: 1, root_domain: "example.com" }],
            servers: [
                { id: 10, name: "入口机", enabled: true },
                { id: 20, name: "节点机", enabled: true },
            ],
            assignments: [
                {
                    id: 30,
                    purpose: "entry",
                    domain: "entry.example.com",
                    server_id: 10,
                    enabled: true,
                },
            ],
        },
    });
    render(<NodeDomainBinding node={{ id: 3, type: "v2box", port: 443 }} />);
    await screen.findByLabelText("接入方式");
    fireEvent.change(screen.getByLabelText("接入方式"), {
        target: { value: "relay" },
    });
    fireEvent.change(screen.getByLabelText("节点服务器"), {
        target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("共享入口域名"), {
        target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("入口端口"), {
        target: { value: "8443" },
    });
    fireEvent.change(screen.getByLabelText("子域名前缀"), {
        target: { value: "origin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存域名" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/domains/bind",
            {
                credential_id: 1,
                node_type: "v2box",
                node_id: 3,
                prefix: "origin",
                family: "ipv4",
                server_id: 20,
                entry_id: 30,
                entry_port: 8443,
            },
        ),
    );
    expect(
        api.request.mock.calls.some((c) =>
            String(c[0]).endsWith("domains/activate"),
        ),
    ).toBe(false);
});
it("requires both entry readiness and publication of a changed entry port", () => {
    const binding = {
        enabled: true,
        managed: true,
        entry_id: 30,
        entry_port: 8443,
        published_port: 443,
        domain: "origin.example.com",
        connection_domain: "entry.example.com",
        published_domain: "entry.example.com",
        family: "ipv4",
        ipv4: "8.8.8.8",
        ipv4_seen_at: 1000,
        last_success: 1000,
        status: "healthy",
        entry_ready: false,
    };
    expect(nodeDomainProgress(binding, { tls: 2 }, 1000).title).toBe("下一步：检查中转入口服务器");
    expect(nodeDomainProgress(binding, { tls: 2 }, 1000).canActivate).toBe(
        false,
    );
    expect(
        nodeDomainProgress({ ...binding, entry_ready: true }, { tls: 2 }, 1000)
            .canActivate,
    ).toBe(true);
    expect(
        nodeDomainProgress(
            { ...binding, entry_ready: true, published_port: 8443 },
            { tls: 2 },
            1000,
        ).active,
    ).toBe(true);
    expect(
        nodeDomainProgress(
            { ...binding, entry_ready: true, server_enabled: false },
            { tls: 2 },
            1000,
        ).canActivate,
    ).toBe(false);
});

import { relayStreamConfig } from "./node-relay";
it("produces runtime-resolved L4 configuration with distinct entry and origin ports", () => {
    const binding = {
        id: 2,
        domain: "origin.example.com",
        entry_port: 8443,
        family: "ipv4",
    };
    const tcp = relayStreamConfig(
        binding,
        { protocol: "anytls", server_port: 9443 },
        { family: "dual" },
    );
    expect(tcp).toContain("server origin.example.com:9443 resolve;");
    expect(tcp).toContain("listen 8443;");
    expect(tcp).toContain("listen [::]:8443 ipv6only=on;");
    expect(tcp).toContain("ipv6=off");
    expect(tcp).not.toContain("proxy_ssl");
    expect(tcp).not.toContain("proxy_protocol");
    const connection = relayStreamConfig(
        { ...binding, scope: "connection" },
        { protocol: "anytls", server_port: 9443 },
        { family: "dual" },
    );
    expect(connection).toContain("upstream v2box_connection_2");
    expect(connection).not.toContain("upstream v2box_origin_2");
    const udp = relayStreamConfig(
        binding,
        { protocol: "tuic", server_port: 9443 },
        { family: "ipv4" },
    );
    expect(udp).toContain("listen 8443 udp reuseport;");
    expect(udp).not.toContain("listen [::]");
    expect(
        relayStreamConfig(
            { ...binding, domain: "bad; include evil;" },
            { server_port: 443 },
            { family: "ipv4" },
        ),
    ).toBe("");
});

it("shows server use and a valid report time when only one address family reported", () => {
    render(
        <NetworkServers
            data={{
                servers: [
                    {
                        id: 7,
                        name: "Shared machine",
                        enabled: true,
                        family: "ipv4",
                        ipv4_seen_at: 1792800000,
                    },
                ],
                assignments: [
                    { id: 1, server_id: 7, node_type: "v2box", node_id: 3 },
                    { id: 2, server_id: 7, node_type: "v2box", node_id: 3 },
                    { id: 4, server_id: 7, purpose: "entry" },
                ],
            }}
            reload={() => {}}
        />,
    );
    expect(screen.getByText("1 个代理服务 · 1 个入口域名")).toBeTruthy();
    expect(screen.queryByText("尚未上报")).toBeNull();
    expect(screen.queryByText("Invalid Date")).toBeNull();
});

function serverEntryFixture() {
    const data = {
        servers: [
            { id: 10, name: "Entry machine", family: "dual", enabled: true },
        ],
        credentials: [{ id: 1, root_domain: "example.test" }],
        assignments: [
            {
                id: 20,
                server_id: 10,
                purpose: "entry",
                credential_id: 1,
                domain: "old.example.test",
                family: "ipv4",
                status: "healthy",
                connection_count: 2,
            },
            {
                id: 21,
                server_id: 11,
                purpose: "entry",
                domain: "other.example.test",
                family: "ipv4",
            },
        ],
    };
    api.request.mockImplementation(async (path: string) =>
        String(path).includes("network/traffic?")
            ? { data: { budget: null, nodes: [], history: [] } }
            : String(path).endsWith("traffic-budget/fetch")
              ? { data: [] }
              : { data: { id: 10, entryId: 20 } },
    );
    return data;
}
it("offers optional relay configuration only inside server creation and submits one atomic request", async () => {
    const data = serverEntryFixture();
    render(<NetworkServers data={data} reload={() => {}} />);
    expect(screen.queryByRole("button", { name: "添加入口域名" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    expect(screen.queryByLabelText("入口根域名")).toBeNull();
    fireEvent.change(screen.getByLabelText("服务器名称"), {
        target: { value: "New entry" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "预设用途" }),{target:{value:"entry"}});
    fireEvent.change(screen.getByLabelText("入口根域名"), {
        target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("入口子域名前缀"), {
        target: { value: "Relay" },
    });
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "保存" })).toHaveProperty(
            "disabled",
            false,
        ),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/network/save",
            expect.objectContaining({
                name: "New entry",
                entry: { credential_id: 1, prefix: "relay", family: "ipv4" },
                traffic: { limitBytes: 0, countingMode: "both", resetDay: 1 },
            }),
        ),
    );
    expect(
        api.request.mock.calls.some(([path]) =>
            String(path).endsWith("network/entry"),
        ),
    ).toBe(false);
});
it("scopes existing entry management to the server details without another server selector", async () => {
    const data = serverEntryFixture();
    render(<NetworkServers data={data} reload={() => {}} />);
    expect(screen.queryByText("old.example.test")).toBeNull();
    await waitFor(()=>expect(screen.getByRole("button",{name:"管理"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    expect(await screen.findByText("old.example.test")).toBeTruthy();
    expect(screen.queryByText("other.example.test")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加入口域名" }));
    expect(screen.queryByLabelText("入口服务器")).toBeNull();
    fireEvent.change(screen.getByLabelText("入口根域名"), {
        target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("入口子域名前缀"), {
        target: { value: "new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存入口域名" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/network/entry",
            {
                id: undefined,
                server_id: 10,
                credential_id: 1,
                prefix: "new",
                family: "dual",
            },
        ),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
it("retains entry input on server save failure and allows opting out without an entry payload", async () => {
    const data = serverEntryFixture();
    api.request.mockImplementation(async (path: string) =>
        String(path).endsWith("network/save")
            ? Promise.reject(new Error("域名已被使用"))
            : { data: [] },
    );
    render(<NetworkServers data={data} reload={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    fireEvent.change(screen.getByLabelText("服务器名称"), {
        target: { value: "New" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "预设用途" }),{target:{value:"entry"}});
    fireEvent.change(screen.getByLabelText("入口根域名"), {
        target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("入口子域名前缀"), {
        target: { value: "keep" },
    });
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "保存" })).toHaveProperty(
            "disabled",
            false,
        ),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("域名已被使用")).toBeTruthy();
    expect(screen.getByLabelText("入口子域名前缀")).toHaveProperty(
        "value",
        "keep",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "预设用途" }),{target:{value:"proxy"}});
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(
            api.request.mock.calls.filter(([path]) =>
                String(path).endsWith("network/save"),
            ),
        ).toHaveLength(2),
    );
    const body = api.request.mock.calls.filter(([path]) =>
        String(path).endsWith("network/save"),
    )[1][1];
    expect(body).not.toHaveProperty("entry");
});

it("protects referenced entries and keeps edit errors within the server detail", async () => {
    const data = serverEntryFixture();
    render(<NetworkServers data={data} reload={() => {}} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"管理"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    expect(
        await screen.findByRole("button", { name: "编辑入口" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "删除入口" })).toHaveProperty(
        "disabled",
        true,
    );
    expect(screen.getByRole("button", { name: "添加入口域名" })).toHaveProperty(
        "disabled",
        false,
    );
});
it("edits an unused entry in its original server and retains input if a concurrent reference rejects it", async () => {
    const data = serverEntryFixture();
    data.assignments[0].connection_count = 0;
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (path: string, ...args: any[]) =>
        String(path).endsWith("network/entry")
            ? Promise.reject(new Error("正在使用的入口请新增域名"))
            : original(path, ...args),
    );
    render(<NetworkServers data={data} reload={() => {}} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"管理"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑入口" }));
    expect(screen.getByLabelText("入口子域名前缀")).toHaveProperty(
        "value",
        "old",
    );
    fireEvent.change(screen.getByLabelText("入口子域名前缀"), {
        target: { value: "changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存入口域名" }));
    expect(await screen.findByText("正在使用的入口请新增域名")).toBeTruthy();
    expect(screen.getByLabelText("入口子域名前缀")).toHaveProperty(
        "value",
        "changed",
    );
    expect(api.request).toHaveBeenCalledWith(
        "test-admin/server/network/entry",
        {
            id: 20,
            server_id: 10,
            credential_id: 1,
            prefix: "changed",
            family: "ipv4",
        },
    );
});

it("requires saving server edits before generating or resetting report authorization", async () => {
    const data = serverEntryFixture();
    render(<NetworkServers data={data} reload={() => {}} />);
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "管理" })).toHaveProperty(
            "disabled",
            false,
        ),
    );
    await waitFor(()=>expect(screen.getByRole("button",{name:"管理"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    await waitFor(() =>
        expect(
            screen.getByRole("button", { name: "配置服务器上报" }),
        ).toHaveProperty("disabled", false),
    );
    fireEvent.change(screen.getByLabelText("服务器名称"), {
        target: { value: "Unsaved server" },
    });
    expect(
        screen.getByRole("button", { name: "配置服务器上报" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByText("凭据维护"));
    expect(screen.getByRole("button", { name: "重置上报凭据" })).toHaveProperty(
        "disabled",
        true,
    );
    expect(
        api.request.mock.calls.some(([path]) =>
            String(path).endsWith("network/enroll"),
        ),
    ).toBe(false);
});
it("shows entry DNS records and limits inventory rendering without extra requests", async () => {
    const fixture = serverEntryFixture();
    fixture.assignments = Array.from({ length: 25 }, (_, i) => ({
        ...fixture.assignments[0],
        id: 100 + i,
        domain: `entry-${i}.example.test`,
    }));
    api.request.mockImplementation(async (path: string) =>
        String(path).endsWith("ddns/fetch")
            ? { data: fixture }
            : { data: [], total: 0 },
    );
    render(<AdminDDNS />);
    await screen.findAllByText("entry-0.example.test");
    const inventory = within(screen.getAllByRole("table")[1]);
    expect(inventory.queryByText("entry-24.example.test")).toBeNull();
    expect(screen.getAllByText("中转入口")).toHaveLength(20);
    fireEvent.change(screen.getByLabelText("搜索域名"), {
        target: { value: "entry-24" },
    });
    expect(inventory.getByText("entry-24.example.test")).toBeTruthy();
    expect(inventory.queryByText("entry-0.example.test")).toBeNull();
});

it("retains the server editor when report enrollment fails and revokes only after confirmation", async () => {
    const data = serverEntryFixture();
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (path: string, ...args: any[]) =>
        String(path).endsWith("network/enroll")
            ? Promise.reject(new Error("授权生成失败"))
            : original(path, ...args),
    );
    render(<NetworkServers data={data} reload={() => {}} />);
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "管理" })).toHaveProperty(
            "disabled",
            false,
        ),
    );
    await waitFor(()=>expect(screen.getByRole("button",{name:"管理"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    fireEvent.click(screen.getByRole("button", { name: "配置服务器上报" }));
    expect(await screen.findByText("授权生成失败")).toBeTruthy();
    expect(screen.getByLabelText("服务器名称")).toHaveProperty(
        "value",
        "Entry machine",
    );
    fireEvent.click(screen.getByText("凭据维护"));
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "重置上报凭据" }));
    expect(
        api.request.mock.calls.some(([path]) =>
            String(path).endsWith("network/reset"),
        ),
    ).toBe(false);
    confirmation.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "重置上报凭据" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/network/reset",
            { id: 10, confirm: true },
        ),
    );
});

import { serverForwardingRows, ServerForwarding, serverPurpose } from "./ServerForwarding";
import { NodeSetupGuide } from "./NodeSetupGuide";
it("scopes forwarding to both current and pending ingress servers without losing published references",()=>{
    const data={assignments:[{id:10,purpose:"entry",server_id:1,domain:"old.example.test"},{id:20,purpose:"entry",server_id:2,domain:"new.example.test"}],connections:[{id:5,node_id:7,node_type:"v2box",entry_id:20,entry_port:8443,published:{entry_id:10,entry_server_id:1,host:"old.example.test",port:443,origin_domain:"origin.example.test",origin_port:9443}}]};
    expect(serverForwardingRows(1,data)).toHaveLength(1);
    expect(serverForwardingRows(2,data)).toHaveLength(1);
    expect(serverForwardingRows(3,data)).toHaveLength(0);
    expect(serverForwardingRows(1,data)[0].status).toBe("有待发布变更");
    render(<ServerForwarding server={{id:1}} data={data}/>);fireEvent.click(screen.getByText("本机入口转发（1 条）"));
    expect(screen.getByRole("link",{name:"新增或选择节点"}).getAttribute("href")).toBe("#/nodes");
    expect(api.request).not.toHaveBeenCalled();
});
it("explains existing-server entry creation and separates the two deployment machines",()=>{
    render(<NodeSetupGuide/>);fireEvent.click(screen.getByText("新增节点与部署流程"));
    fireEvent.click(screen.getByRole("button",{name:"中转节点"}));
    expect(screen.getByText(/已有服务器在/)).toBeTruthy();
    expect(screen.getByText(/面板不会自动安装转发/)).toBeTruthy();
    expect(screen.getByText(/无需再次安装 V2Box/)).toBeTruthy();
});

it("keeps the old relay visible on its server while a service is changing to direct access",()=>{
    const rows=serverForwardingRows(1,{assignments:[{id:1,purpose:"entry",server_id:1,domain:"entry.example.test"},{id:2,purpose:"node",node_type:"v2box",node_id:9,domain:"origin.example.test",entry_id:null,published_domain:"entry.example.test",published_port:443,published_origin:"origin.example.test"}]});
    expect(rows).toHaveLength(1);expect(rows[0].saved).toBe("直连（待启用）");expect(rows[0].status).toBe("有待启用变更");
});

it("preserves a dirty domain draft and its revision during status polling",async()=>{
    vi.useFakeTimers();let changed=false;
    api.request.mockImplementation(async(path:string)=>{
        if(path.endsWith("domains/bind"))throw new Error("域名配置已被其他管理员修改");
        return {data:{credentials:[{id:1,root_domain:"example.com"}],servers:[],assignments:[{id:2,node_type:"v2box",node_id:3,credential_id:1,domain:changed?"other.example.com":"hk.example.com",family:"ipv4",enabled:true,managed:true,status:"healthy",ipv4:"8.8.8.8",ipv4_seen_at:Date.now()/1000,last_success:Date.now()/1000,configuration_revision:(changed?"b":"a").repeat(64)}]}};
    });
    await act(async()=>{render(<NodeDomainBinding node={{id:3,type:"v2box",host:"hk.example.com",port:443}}/>);});
    fireEvent.click(screen.getByText("修改域名设置"));
    fireEvent.change(screen.getByLabelText("子域名前缀"),{target:{value:"unsaved"}});
    changed=true;await act(()=>vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByLabelText("子域名前缀")).toHaveProperty("value","unsaved");
    await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"保存域名"}));});
    expect(api.request).toHaveBeenCalledWith("test-admin/server/domains/bind",expect.objectContaining({prefix:"unsaved",revision:"a".repeat(64)}));
    expect(screen.getByText("域名配置已被其他管理员修改")).toBeTruthy();
    expect(screen.getByLabelText("子域名前缀")).toHaveProperty("value","unsaved");
});

it("switches between managed and manual configuration without rebuilding the physical server",async()=>{
    let manual=false;
    api.request.mockImplementation(async(path:string)=>{
        if(path.endsWith("domains/manual")){manual=true;return {data:true};}
        if(path.includes("connections/address"))return {data:{values:{host:"hk.example.com",port:443},managed:false,revision:"c".repeat(64)}};
        return {data:{credentials:[{id:1,root_domain:"example.com"}],servers:[{id:9,name:"Existing",enabled:true,family:"ipv4"}],assignments:[{id:2,node_type:"v2box",node_id:3,server_id:9,credential_id:1,domain:"hk.example.com",family:"ipv4",enabled:!manual,managed:!manual,status:manual?"manual":"healthy",configuration_revision:(manual?"b":"a").repeat(64)}]}};
    });
    vi.spyOn(window,"confirm").mockReturnValue(true);
    render(<NodeDomainBinding node={{id:3,type:"v2box",host:"hk.example.com",port:443}}/>);
    fireEvent.click(await screen.findByText("修改域名设置"));
    await waitFor(()=>expect(screen.getByRole("button",{name:"改为手动维护"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"改为手动维护"}));
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/domains/manual",{id:2,revision:"a".repeat(64),confirm:true}));
    expect(await screen.findByRole("button",{name:"保存连接地址"})).toBeTruthy();
    expect(screen.queryByText("修改域名设置")).toBeNull();
    fireEvent.click(screen.getByText("设置节点域名"));
    expect(screen.getByLabelText("子域名前缀")).toHaveProperty("value","hk");
    expect(screen.getByLabelText("节点服务器")).toHaveProperty("value","9");
    expect(api.request.mock.calls.some(([path])=>String(path).includes("network/save"))).toBe(false);
});

it("derives server purpose from actual entry and proxy ownership without persisting a conflicting role",()=>{
 const data={assignments:[{server_id:1,purpose:"entry"},{server_id:2,purpose:"node"},{server_id:3,purpose:"entry"},{server_id:3,purpose:"node"}]};
 expect(serverPurpose(1,data)).toBe("中转入口服务器");expect(serverPurpose(2,data)).toBe("代理服务器");expect(serverPurpose(3,data)).toBe("混合用途（入口与代理）");expect(serverPurpose(4,data)).toBe("待配置用途");
});
it("opens the existing forwarding editor lazily from its owning server and handles missing nodes",async()=>{
 api.request.mockResolvedValue({data:[]});
 render(<ServerForwarding server={{id:1}} data={{assignments:[{id:10,purpose:"entry",server_id:1,domain:"entry.test"}],connections:[{id:5,node_type:"v2box",node_id:7,entry_id:10,entry_port:443}]}}/>);
 expect(api.request).not.toHaveBeenCalled();fireEvent.click(screen.getByText("本机入口转发（1 条）"));fireEvent.click(screen.getByRole("button",{name:"配置转发与验证"}));
 expect(await screen.findByText("节点不可用，请刷新服务器列表后重试。")).toBeTruthy();
 expect(api.request.mock.calls.every(([,body])=>!body)).toBe(true);
});

it("uses the matching backend and opens forwarding without issuing a deployment grant",async()=>{
 api.request.mockImplementation(async(path:string)=>String(path).endsWith("manage/getNodes") ? {data:[{id:7,type:"v2node",name:"Wrong backend"},{id:7,type:"v2box",name:"Selected relay",server_port:9443}]} : String(path).endsWith("ddns/fetch") ? {data:{servers:[],assignments:[],credentials:[]}} : String(path).includes("connections/address") ? {data:{values:{host:"origin.test",port:"443"},revision:"a".repeat(64),managed:false}} : {data:[]});
 render(<ServerForwarding server={{id:1}} data={{assignments:[{id:10,purpose:"entry",server_id:1,domain:"entry.test"},{id:20,purpose:"node",server_id:2,node_type:"v2box",node_id:7,entry_id:10,entry_port:443}]}}/>);
 fireEvent.click(screen.getByText("本机入口转发（1 条）"));fireEvent.click(screen.getByRole("button",{name:"配置转发与验证"}));
 expect(await screen.findByRole("dialog",{name:"Selected relay · 接入设置"})).toBeTruthy();
 expect(screen.queryByText("Wrong backend · 接入设置")).toBeNull();
 expect(api.request.mock.calls.every(([path,body])=>!body && !String(path).includes("credentials/deployment"))).toBe(true);
});

import {relayCertificateIssue} from "./node-relay";
it("checks relay certificate modes without treating masked credentials as missing",()=>{
 for (const mode of ["http","self","none",undefined]) expect(relayCertificateIssue({tls:1,tls_settings:{cert_mode:mode}})).toContain("协议与证书");
 for (const mode of ["dns","remote","file"]) expect(relayCertificateIssue({tls:1,tls_settings:{cert_mode:mode}})).toBe("");
 expect(relayCertificateIssue({tls:2,tls_settings:{cert_mode:"none"}})).toBe("");
 expect(relayCertificateIssue({tls:0})).toBe("");
 expect(relayCertificateIssue({tls:1,"tls_settings.cert_mode":"dns"})).toBe("");
});
