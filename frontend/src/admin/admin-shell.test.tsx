// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
vi.mock("../shared/api", () => ({
    boot: { title: "Test console", adminPath: "test-admin" },
}));
import { AdminShell } from "./admin-shell";
afterEach(cleanup);
it("opens the account menu with the keyboard and restores focus when Escape closes it", async () => {
    render(
        <AdminShell
            current="users"
            user={{ email: "admin@example.test" }}
            logout={vi.fn()}
        >
            <p>Content</p>
        </AdminShell>,
    );
    const trigger = screen.getByRole("button", { name: "账户菜单" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const item = await screen.findByRole("menuitem", { name: "用户端" });
    await waitFor(() => expect(document.activeElement).toBe(item));
    fireEvent.keyDown(item, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
});
