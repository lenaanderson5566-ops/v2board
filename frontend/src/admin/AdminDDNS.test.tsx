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
