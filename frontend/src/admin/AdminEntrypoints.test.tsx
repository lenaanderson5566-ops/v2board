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
