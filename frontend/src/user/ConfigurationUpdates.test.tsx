// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../shared/api", () => ({ boot: { mode: "user" }, readRequest: mocks.read, date: () => "" }));
vi.mock("../shared/i18n", () => ({
    locale: () => "en-US",
    tx: (key: string, values: Record<string, unknown> = {}) => Object.entries(values).reduce((copy, [name, value]) => copy.replaceAll(`{{${name}}}`, String(value)), key),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./product-analytics", () => ({ useAnalyticsPage: () => undefined }));
vi.mock("./FastaiDownload", () => ({ FastaiDownload: () => null }));
vi.mock("../shared/BannerStrip", () => ({ BannerStrip: () => null }));
vi.mock("./AccountSecurity", () => ({ AccountSecurity: () => <p>Security settings</p> }));
vi.mock("./user", () => Object.fromEntries(["UserDashboard", "Subscribe", "Plans", "Orders", "Knowledge", "Tickets", "Invite", "Profile", "Notifications", "Traffic"].map(name => [name, () => null])));
import { ConfigurationUpdates } from "./ConfigurationUpdates";
import UserContent from "./user-entry";
import { UserStatusGate } from "./UserStatusGate";
import { configureTimeZone, setDisplayTimeZone } from "../shared/timezone";

const first = { id: 1, requestedAt: "2026-01-01T00:30:00Z", clientName: "Clash Verge Rev", clientVersion: "2.4.0", status: "success", reason: null as string | null, ip: "203.0.113.*", location: "Region" };
const response = (data = [first], total = data.length, retentionDays: number | null = 30) => ({ data, total, meta: { pagination: { page: 1, pageSize: 20, total, totalPages: Math.ceil(total / 20) }, retentionDays } });
beforeEach(() => {
    mocks.read.mockReset().mockResolvedValue(response());
    configureTimeZone("UTC", false);
    setDisplayTimeZone("America/Los_Angeles");
});
afterEach(() => { cleanup(); setDisplayTimeZone(null); vi.restoreAllMocks(); });

it("shows only safe request fields in the personal time zone and explains success without claiming connectivity", async () => {
    render(<ConfigurationUpdates />);
    expect(await screen.findByText("Clash Verge Rev")).toBeTruthy();
    expect(screen.getByText(/12\/31\/2025, 16:30:00/)).toBeTruthy();
    expect(screen.getByText("仅显示最近 30 天内保留的记录。")).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回账户安全" }).getAttribute("href")).toBe("#/security");
    expect(screen.queryByText("请求详情")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByText("记录客户端获取或更新配置的请求，不代表导入或连接成功。")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.read).toHaveBeenCalledWith("user/subscription/access-records?page=1&pageSize=20", undefined, false);
});

it("treats unknown fields and status conservatively without exposing raw diagnostic data", async () => {
    mocks.read.mockResolvedValue(response([{ id: 2, requestedAt: null, status: "future-status", clientName: null, clientVersion: null, ip: null, location: null, reason: "private-reason", rawUserAgent: "private-agent", url: "https://example.test/private-token" } as any]));
    render(<ConfigurationUpdates />);
    expect(await screen.findByText("结果未知")).toBeTruthy();
    expect(screen.getByText("客户端未识别")).toBeTruthy();
    expect(screen.getByText("来源未知")).toBeTruthy();
    expect(screen.queryByText("地区未知")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("请求成功")).toBeNull();
    expect(screen.queryByText(/private-reason|private-agent|private-token/)).toBeNull();
});

it("describes an empty retained window without implying that the subscription was never used", async () => {
    mocks.read.mockResolvedValue(response([], 0, null));
    render(<ConfigurationUpdates />);
    expect(await screen.findByText("保留范围内暂无配置更新记录。")).toBeTruthy();
    expect(screen.getByText("仅显示当前保留范围内的记录。")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("navigation", {name: "分页"})).toBeNull();
});

it("explains historical subscription failures without displaying unknown reason codes", async () => {
    mocks.read.mockResolvedValue(response([
        { ...first, status: "failed", reason: "expired" },
        { ...first, id: 2, status: "failed", reason: "private-diagnostic-reason" },
    ]));
    render(<ConfigurationUpdates />);
    expect(await screen.findByText("此次请求时订阅已到期，请检查有效期或续费后更新配置。")).toBeTruthy();
    expect(screen.queryByText("配置请求未完成，请检查客户端设置后重试。")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.queryByText("private-diagnostic-reason")).toBeNull();
});

it("requests the selected page and never presents old rows as a failed new page", async () => {
    mocks.read.mockImplementation(async (path: string) => {
        if (path.includes("page=2")) throw new Error("Page unavailable");
        return response([first], 41);
    });
    render(<ConfigurationUpdates />);
    await screen.findByText("Clash Verge Rev");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("Page unavailable")).toBeTruthy();
    expect(screen.queryByText("Clash Verge Rev")).toBeNull();
    expect(mocks.read).toHaveBeenCalledWith("user/subscription/access-records?page=2&pageSize=20", undefined, false);
    expect(screen.queryByRole("navigation", { name: "分页" })).toBeNull();
    expect(screen.queryByText(/第 0 页/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await screen.findByText("Clash Verge Rev");
    expect(mocks.read).toHaveBeenLastCalledWith("user/subscription/access-records?page=1&pageSize=20", undefined, false);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("Page unavailable");
    mocks.read.mockResolvedValueOnce(response([{ ...first, id: 21, clientName: "sing-box" }], 41));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("sing-box")).toBeTruthy();
    expect(mocks.read).toHaveBeenLastCalledWith("user/subscription/access-records?page=2&pageSize=20", undefined, true);
});

it("ignores a late response from an abandoned page", async () => {
    let finish!: (value: unknown) => void;
    mocks.read.mockResolvedValueOnce(response([first], 41)).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(response([{ ...first, clientName: "Current client" }], 41));
    const previous = render(<ConfigurationUpdates />);
    await screen.findByText("Clash Verge Rev");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    previous.unmount();
    render(<ConfigurationUpdates />);
    await screen.findByText("Current client");
    await act(async () => finish(response([{ ...first, clientName: "Abandoned page" }], 41)));
    expect(screen.queryByText("Abandoned page")).toBeNull();
    expect(screen.getByText("Current client")).toBeTruthy();
});

it("refreshes explicitly while focus and visibility events do not request the history again", async () => {
    render(<ConfigurationUpdates />);
    await screen.findByText("Clash Verge Rev");
    await act(async () => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("data-changed"));
        document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.read.mockResolvedValueOnce(response([{ ...first, clientName: "Updated client" }]));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("Updated client")).toBeTruthy();
    expect(mocks.read).toHaveBeenLastCalledWith("user/subscription/access-records?page=1&pageSize=20", undefined, true);
});

it("loads the independent security route for an expired subscription without a plan gate", async () => {
    mocks.read.mockImplementation(async (path: string) => path === "user/info"
        ? { data: { account_status: { state: "expired" } } } : response());
    render(<UserStatusGate logout={vi.fn()} support={null}><UserContent current="security" path="security/configuration-updates" /></UserStatusGate>);
    expect(await screen.findByRole("heading", { name: "配置更新记录" })).toBeTruthy();
    expect(await screen.findByText("Clash Verge Rev")).toBeTruthy();
    expect(screen.queryByText("Security settings")).toBeNull();
    expect(mocks.read.mock.calls.some(([path]) => path.includes("user/order") || path.includes("user/plan"))).toBe(false);
});
