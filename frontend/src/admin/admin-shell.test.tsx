// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
vi.mock("../shared/api", () => ({
    boot: { title: "Test console", adminPath: "test-admin" },
}));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
import { AdminShell } from "./admin-shell";
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
});
const user = { email: "admin@example.test" };
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
it("finds workspace subpages directly and restores the full menu after clearing search", () => {
    render(
        <AdminShell current="users" user={user} logout={vi.fn()}>
            <p>Content</p>
        </AdminShell>,
    );
    const search = screen.getByRole("searchbox", { name: "搜索后台页面" });
    fireEvent.change(search, { target: { value: "充值规则" } });
    expect(
        screen.getByRole("link", { name: /^充值规则/ }).getAttribute("href"),
    ).toBe("#/payment-deposit");
    expect(screen.queryByRole("link", { name: "用户管理" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除页面搜索" }));
    expect(screen.getByRole("link", { name: "用户管理" })).toBeTruthy();
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "missing-page-404" } });
    expect(screen.getByRole("status").textContent).toBe(
        "未找到匹配页面，请尝试其他关键词。",
    );
});
it("labels and focuses the actual subpage while keeping its workspace highlighted", () => {
    const view = render(
        <AdminShell
            current="payments"
            page="payments"
            user={user}
            logout={vi.fn()}
        >
            <p>Content</p>
        </AdminShell>,
    );
    expect(document.title).toBe("支付与充值 · Test console");
    view.rerender(
        <AdminShell
            current="payments"
            page="payment-deposit"
            user={user}
            logout={vi.fn()}
        >
            <p>Deposit</p>
        </AdminShell>,
    );
    expect(
        screen.getByRole("heading", { level: 1, name: "充值规则" }),
    ).toBeTruthy();
    expect(document.title).toBe("充值规则 · Test console");
    expect(document.activeElement?.id).toBe("admin-main-content");
    expect(
        screen
            .getByRole("link", { name: "支付与充值" })
            .getAttribute("aria-current"),
    ).toBe("page");
    view.rerender(
        <AdminShell
            current="payments"
            page="payments"
            user={user}
            logout={vi.fn()}
        >
            <p>Payments</p>
        </AdminShell>,
    );
    expect(
        screen.getByRole("heading", { level: 1, name: "支付与充值" }),
    ).toBeTruthy();
});
it("confines mobile navigation focus, blocks background interaction and restores the trigger", async () => {
    vi.stubGlobal("matchMedia", () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    document.body.style.overflow = "clip";
    const view = render(
        <AdminShell current="users" user={user} logout={vi.fn()}>
            <button>Page action</button>
        </AdminShell>,
    );
    expect(
        view.container.querySelector("#sidebar")?.hasAttribute("inert"),
    ).toBe(true);
    const trigger = screen.getByRole("button", { name: "打开导航" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "后台导航" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
        view.container.querySelector("#main-container")?.hasAttribute("inert"),
    ).toBe(true);
    expect(
        view.container.querySelector("#page-header")?.hasAttribute("inert"),
    ).toBe(true);
    expect(document.activeElement).toBe(
        screen.getByRole("searchbox", { name: "搜索后台页面" }),
    );
    expect(document.body.style.overflow).toBe("hidden");
    const first = within(dialog).getByRole("link", { name: "Test console" });
    const last = within(dialog).getByRole("link", { name: "字典维护" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("clip");
    expect(
        view.container.querySelector("#main-container")?.hasAttribute("inert"),
    ).toBe(false);
});
it("closes mobile navigation on an accepted subpage change without moving focus back to the menu trigger", async () => {
    vi.stubGlobal("matchMedia", () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    const view = render(
        <AdminShell
            current="payments"
            page="payments"
            user={user}
            logout={vi.fn()}
        >
            <p>Content</p>
        </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "充值规则" },
    });
    view.rerender(
        <AdminShell
            current="payments"
            page="payment-deposit"
            user={user}
            logout={vi.fn()}
        >
            <p>Deposit</p>
        </AdminShell>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement?.id).toBe("admin-main-content");
    expect(
        (
            view.container.querySelector(
                'input[type="search"]',
            ) as HTMLInputElement
        ).value,
    ).toBe("");
});
