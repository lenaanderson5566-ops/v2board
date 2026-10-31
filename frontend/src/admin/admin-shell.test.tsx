// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState, useSyncExternalStore } from "react";
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
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key, locale: () => "zh-CN" }));
import { AdminShell } from "./admin-shell";
import { AdminDisplayTimeZoneProvider, adminDisplayTimeZoneKey } from "./AdminDisplayTimeZone";
import { businessTimeZone, configureTimeZone, displayTimeZone, formatInstant, setAdminDisplayTimeZone, subscribeTimeZone } from "../shared/timezone";
import { boot } from "../shared/api";
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
    vi.restoreAllMocks();
    setAdminDisplayTimeZone("business");
    configureTimeZone("Asia/Shanghai", true);
    localStorage.clear();
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

async function openTimeZoneSettings() {
    const trigger = screen.getByRole("button", { name: "账户菜单" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "界面显示时区" }));
    const dialog = await screen.findByRole("dialog", { name: "界面显示时区" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    return dialog;
}

it("changes only the admin display zone, persists per account and keeps an existing page draft mounted", async () => {
    configureTimeZone("UTC", true);
    const account = { id: 101, email: "admin@example.test" };
    const mounted = vi.fn();
    function Records() {
        useSyncExternalStore(subscribeTimeZone, displayTimeZone, displayTimeZone);
        const [draft, setDraft] = useState("");
        useEffect(() => { mounted(); }, []);
        return <><time data-testid="event-time">{formatInstant("2026-11-30T23:30:37Z", { timeZoneName: undefined })}</time>
            <input aria-label="未保存草稿" value={draft} onChange={event => setDraft(event.target.value)} /></>;
    }
    const view = render(<AdminDisplayTimeZoneProvider user={account}>
        <AdminShell current="users" user={account} logout={vi.fn()}><Records /></AdminShell>
    </AdminDisplayTimeZoneProvider>);
    fireEvent.change(screen.getByLabelText("未保存草稿"), { target: { value: "Keep this draft" } });
    await openTimeZoneSettings();
    fireEvent.click(screen.getByRole("button", { name: /^指定时区$/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "指定界面显示时区" }), { target: { value: "Asia/Shanghai" } });
    expect(displayTimeZone()).toBe("Asia/Shanghai");
    expect(businessTimeZone()).toBe("UTC");
    expect(screen.getByTestId("event-time").textContent).toContain("2026/12/01 07:30:37");
    expect((screen.getByLabelText("未保存草稿") as HTMLInputElement).value).toBe("Keep this draft");
    expect(mounted).toHaveBeenCalledOnce();
    expect(localStorage.getItem(adminDisplayTimeZoneKey(account))).toBe("Asia/Shanghai");
    fireEvent.click(screen.getByRole("button", { name: "跟随业务时区" }));
    expect(displayTimeZone()).toBe("UTC");
    expect(mounted).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /^跟随设备$/ }));
    expect(displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    expect(localStorage.getItem(adminDisplayTimeZoneKey(account))).toBe("device");
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "界面显示时区" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "账户菜单" }));
    view.unmount();
    expect(displayTimeZone()).toBe("UTC");
});

it("restores account-specific display preferences without rendering another admin's zone", () => {
    configureTimeZone("UTC", true);
    const first = { id: 201 }, second = { id: 202 };
    localStorage.setItem(adminDisplayTimeZoneKey(first), "America/New_York");
    localStorage.setItem(adminDisplayTimeZoneKey(second), "Asia/Tokyo");
    const observed: [number, string][] = [];
    function Content({ id }: { id: number }) {
        observed.push([id, displayTimeZone()]);
        return <p>{displayTimeZone()}</p>;
    }
    const view = render(<AdminDisplayTimeZoneProvider user={first}><Content id={first.id} /></AdminDisplayTimeZoneProvider>);
    expect(screen.getByText("America/New_York")).toBeTruthy();
    view.rerender(<AdminDisplayTimeZoneProvider user={second}><Content id={second.id} /></AdminDisplayTimeZoneProvider>);
    expect(screen.getByText("Asia/Tokyo")).toBeTruthy();
    expect(observed.filter(([id]) => id === second.id).every(([, zone]) => zone === "Asia/Tokyo")).toBe(true);
    view.rerender(<AdminDisplayTimeZoneProvider user={{ id: 203 }}><Content id={203} /></AdminDisplayTimeZoneProvider>);
    expect(displayTimeZone()).toBe("UTC");
    expect(screen.getByText("UTC")).toBeTruthy();
});

it("keeps display selection usable when preference storage is blocked and reports temporary scope", async () => {
    configureTimeZone("UTC", true);
    const account = { id: 301, email: "admin@example.test" };
    const save = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const view = render(<AdminDisplayTimeZoneProvider user={account}>
        <AdminShell current="users" user={account} logout={vi.fn()}><p>Content</p></AdminShell>
    </AdminDisplayTimeZoneProvider>);
    await openTimeZoneSettings();
    fireEvent.click(screen.getByRole("button", { name: /^指定时区$/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "指定界面显示时区" }), { target: { value: "Asia/Tokyo" } });
    expect(displayTimeZone()).toBe("Asia/Tokyo");
    expect(screen.getByRole("status").textContent).toContain("仅本次打开期间生效");
    expect(businessTimeZone()).toBe("UTC");
    view.unmount();
    expect(displayTimeZone()).toBe("UTC");
    save.mockRestore();
    render(<AdminDisplayTimeZoneProvider user={account}>
        <AdminShell current="users" user={account} logout={vi.fn()}><p>Content</p></AdminShell>
    </AdminDisplayTimeZoneProvider>);
    expect(displayTimeZone()).toBe("Asia/Tokyo");
    await openTimeZoneSettings();
    expect(screen.getByRole("status").textContent).toContain("仅本次打开期间生效");
    fireEvent(window, new StorageEvent("storage", { key: adminDisplayTimeZoneKey(account), newValue: "America/New_York", storageArea: localStorage }));
    expect(displayTimeZone()).toBe("Asia/Tokyo");
    expect(screen.getByRole("status").textContent).toContain("仅本次打开期间生效");
    fireEvent.click(screen.getByRole("button", { name: "跟随业务时区" }));
    expect(displayTimeZone()).toBe("UTC");
    expect(screen.getByRole("status").textContent).toContain("自动保存至当前浏览器");
});

it("isolates preference keys by API, admin path and valid account id; missing ids are never persisted", () => {
    const original = { apiBaseUrl: boot.apiBaseUrl, adminPath: boot.adminPath };
    try {
        const first = adminDisplayTimeZoneKey({ id: 401 });
        (boot as any).apiBaseUrl = "https://other.example.test";
        expect(adminDisplayTimeZoneKey({ id: 401 })).not.toBe(first);
        const remote = adminDisplayTimeZoneKey({ id: 401 });
        (boot as any).adminPath = "another-admin";
        expect(adminDisplayTimeZoneKey({ id: 401 })).not.toBe(remote);
        expect(adminDisplayTimeZoneKey({ id: 402 })).not.toBe(adminDisplayTimeZoneKey({ id: 401 }));
        expect(adminDisplayTimeZoneKey({ email: "same@example.test" })).toBe("");
        expect(adminDisplayTimeZoneKey({ id: "401" })).toBe("");
        expect(adminDisplayTimeZoneKey({ id: 0 })).toBe("");
    } finally { Object.assign(boot, original); }
});

it("uses the business default for a malformed stored preference and synchronizes this account's tabs", () => {
    configureTimeZone("UTC", true);
    const account = { id: 501 };
    const key = adminDisplayTimeZoneKey(account);
    localStorage.setItem(key, "Not/A_Zone");
    render(<AdminDisplayTimeZoneProvider user={account}><p>Content</p></AdminDisplayTimeZoneProvider>);
    expect(displayTimeZone()).toBe("UTC");
    fireEvent(window, new StorageEvent("storage", { key, newValue: "Asia/Kathmandu", storageArea: localStorage }));
    expect(displayTimeZone()).toBe("Asia/Kathmandu");
    fireEvent(window, new StorageEvent("storage", { key: adminDisplayTimeZoneKey({ id: 502 }), newValue: "America/New_York", storageArea: localStorage }));
    expect(displayTimeZone()).toBe("Asia/Kathmandu");
});

it("ignores session-storage and unspecified-area events with the same preference key", () => {
    configureTimeZone("UTC", true);
    const account = { id: 601 };
    const key = adminDisplayTimeZoneKey(account);
    render(<AdminDisplayTimeZoneProvider user={account}><p>Content</p></AdminDisplayTimeZoneProvider>);
    fireEvent(window, new StorageEvent("storage", { key, newValue: "Asia/Tokyo", storageArea: sessionStorage }));
    expect(displayTimeZone()).toBe("UTC");
    fireEvent(window, new StorageEvent("storage", { key, newValue: "America/New_York" }));
    expect(displayTimeZone()).toBe("UTC");
    fireEvent(window, new StorageEvent("storage", { key, newValue: "Asia/Kathmandu", storageArea: localStorage }));
    expect(displayTimeZone()).toBe("Asia/Kathmandu");
});
