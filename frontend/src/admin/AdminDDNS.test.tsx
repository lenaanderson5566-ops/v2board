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
import { AdminDDNS } from "./AdminDDNS";
afterEach(() => {
    cleanup();
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
                            node_type: "v2box",
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
            return { data: [{ id: 3, type: "v2box", name: "Node" }] };
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
function managedSetup() {
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
                        },
                    ],
                },
            };
        return { data: true };
    });
}
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
    fireEvent.click(await screen.findByRole("button", { name: "启用新域名" }));
    expect(
        api.request.mock.calls.some(([p]) => p.endsWith("domains/activate")),
    ).toBe(false);
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "启用新域名" }));
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
