// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminEntrypoints } from "./AdminEntrypoints";
vi.mock("../shared/api", () => ({ admin: (path: string) => path, request: vi.fn() }));
afterEach(cleanup);
it("does not publish without signing trust", () => {
    render(<AdminEntrypoints initial={[]} version={1} save={vi.fn()} />);
    expect((screen.getByRole("button", {name: "发布服务入口"}) as HTMLButtonElement).disabled).toBe(true);
});
it("publishes domain origins and priorities without a private signing key", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminEntrypoints initial={[{origin: "https://fastdog.ws", enabled: true, priority: 1}]} version={12} publicKey="public-key" save={save} />);
    fireEvent.change(screen.getByLabelText("优先级"), {target: {value: "2"}});
    fireEvent.click(screen.getByRole("button", {name: "发布服务入口"}));
    await waitFor(() => expect(save).toHaveBeenCalledWith([{origin: "https://fastdog.ws", enabled: true, priority: 2}]));
    expect((await screen.findByRole("status")).textContent).toContain("服务入口已发布");
});

it("converts entrypoint check instants to the system display zone instead of showing raw ISO", async () => {
    const { request } = await import("../shared/api");
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Shanghai", true);
    setDisplayTimeZone("America/New_York");
    vi.mocked(request).mockResolvedValueOnce({ data: { checkedAt: "2026-11-30T00:00:00Z", durationMs: 12 } });
    render(<AdminEntrypoints initial={[{origin: "https://entry.example.test", enabled: true, priority: 1}]} version={1} publicKey="public-key" save={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "检查服务"}));
    expect(await screen.findByText(/检查通过.*08:00:00/)).toBeTruthy();
    expect(screen.queryByText(/2026-11-30T00:00:00Z/)).toBeNull();
    setDisplayTimeZone(null);
});

it("reformats an existing check when the admin display zone changes without repeating the check or losing edits", async () => {
    const { request } = await import("../shared/api");
    const { configureTimeZone, setAdminDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("UTC", true);
    setAdminDisplayTimeZone("UTC");
    const initial = [{origin:"https://entry.example.test",enabled:true,priority:1}];
    const save = vi.fn();
    vi.mocked(request).mockResolvedValueOnce({data:{checkedAt:"2026-11-30T00:00:37Z",durationMs:12}});
    try {
        const view = render(<AdminEntrypoints initial={initial} version={1} publicKey="public-key" save={save} />);
        fireEvent.change(screen.getByLabelText("优先级"), {target:{value:"2"}});
        fireEvent.click(screen.getByRole("button", {name:"检查服务"}));
        expect(await screen.findByText(/检查通过.*00:00:37/)).toBeTruthy();
        const checks = vi.mocked(request).mock.calls.length;
        setAdminDisplayTimeZone("Asia/Kathmandu");
        view.rerender(<AdminEntrypoints initial={initial} version={1} publicKey="public-key" save={save} />);
        expect(screen.getByText(/检查通过.*05:45:37/)).toBeTruthy();
        expect(screen.getByLabelText("优先级")).toHaveProperty("value","2");
        expect(request).toHaveBeenCalledTimes(checks);
        expect(save).not.toHaveBeenCalled();
    } finally { setAdminDisplayTimeZone("business"); configureTimeZone("Asia/Shanghai",true); }
});
