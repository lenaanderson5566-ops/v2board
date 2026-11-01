// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    useData: vi.fn(),
    request: vi.fn(),
    info: {
        data: { account_status: { state: "active" }, expired_at: null },
        loading: false,
        error: "",
        reload: vi.fn(),
    },
    sub: { data: {}, loading: false, error: "", reload: vi.fn() },
    orders: { data: [] as any[] | null, loading: false, error: "", retryAt: 0, reload: vi.fn() },
    offers: { data: [], loading: false, error: "", reload: vi.fn() },
}));
vi.mock("../shared/ui/data", async (importOriginal) => ({
    ...await importOriginal<typeof import("../shared/ui/data")>(),
    useData: mocks.useData,
}));
vi.mock("../shared/ui", async () => ({
    ...await import("../shared/ui/data"),
    Modal: (await import("../shared/ui/Modal")).Modal,
}));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("../shared/credit-copy", () => ({ c: (key: string) => key }));
vi.mock("../shared/api", () => ({
    boot: { mode: "user" },
    date: () => "test expiry",
    money: (value: number) => `CNY ${value / 100}`,
    bytes: String,
    request: mocks.request,
}));
vi.mock("./UsagePage", () => ({ UsagePage: () => <div>active usage</div> }));
import { AccountEntry } from "./AccountEntry";
import { UserStatusGate } from "./UserStatusGate";
import { UserDashboard } from "./DashboardPage";
afterEach(cleanup);
beforeEach(() => {
    vi.clearAllMocks();
    mocks.info.data.account_status.state = "active";
    Object.assign(mocks.orders, { data: [], loading: false, error: "", retryAt: 0 });
    mocks.useData.mockImplementation((path: string) => {
        if (path === "user/info") return mocks.info;
        if (path === "user/getSubscribe") return mocks.sub;
        if (path === "user/order/fetch") return mocks.orders;
        if (path === "user/coupon/offers") return mocks.offers;
        throw new Error(`Unexpected data request: ${path}`);
    });
});
describe("account entry", () => {
    it("guides new users to a plan without offering a subscription import action", () => {
        render(<AccountEntry state="new" />);
        expect(
            screen.getByRole("link", { name: "选择套餐" }).getAttribute("href"),
        ).toBe("#/plan");
        expect(
            screen.getByRole("link", { name: "使用文档" }).getAttribute("href"),
        ).toBe("#/knowledge");
        expect(screen.queryByRole("link", { name: "配置中心" })).toBeNull();
        expect(screen.getByText("确认与支付")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "一键导入" })).toBeNull();
    });
    it("preserves expired plan details and offers renewal and orders", () => {
        render(
            <AccountEntry
                state="expired"
                subscription={{
                    plan: { name: "Original plan" },
                    expired_at: 1,
                }}
            />,
        );
        expect(screen.getByText("Original plan")).toBeTruthy();
        expect(
            screen.getByRole("link", { name: /renew/ }).getAttribute("href"),
        ).toBe("#/plan");
        expect(
            screen.getByRole("link", { name: "账单" }).getAttribute("href"),
        ).toBe("#/order");
    });
    it("blocks the regular workspace and provides authenticated support and logout", () => {
        mocks.info.data.account_status.state = "banned";
        const logout = vi.fn();
        render(
            <UserStatusGate
                logout={logout}
                support={<div>ticket form</div>}
                fallbackFooter={<footer>privacy entry</footer>}
            >
                <div>normal workspace</div>
            </UserStatusGate>,
        );
        expect(screen.queryByText("normal workspace")).toBeNull();
        expect(screen.getByRole("contentinfo").textContent).toBe(
            "privacy entry",
        );
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "contactAdmin" }));
        expect(screen.getByText("ticket form")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
        expect(logout).toHaveBeenCalledOnce();
        mocks.info.data.account_status.state = "active";
    });
    it("leaves the workspace accessible during a valid subscription", () => {
        render(
            <UserStatusGate
                logout={vi.fn()}
                support={null}
                fallbackFooter={<footer>fallback privacy entry</footer>}
            >
                <div>normal workspace</div>
            </UserStatusGate>,
        );
        expect(screen.getByText("normal workspace")).toBeTruthy();
        expect(screen.queryByText("fallback privacy entry")).toBeNull();
    });
});

describe("new account dashboard", () => {
    const pending = { trade_no: "first-order", status: 0, plan_id: 2, period: "month_price", total_amount: 1500, plan: { name: "Basic" } };
    function dashboard() {
        mocks.info.data.account_status.state = "new";
        return render(<UserDashboard />);
    }
    it("resumes the existing subscription checkout without another choose-plan action", () => {
        mocks.orders.data = [pending];
        dashboard();
        expect(screen.getByRole("link", { name: "继续支付" }).getAttribute("href")).toBe("#/plan/2?order=first-order");
        expect(screen.getByText("Basic")).toBeTruthy();
        expect(screen.getByText("CNY 15")).toBeTruthy();
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("shows processing without payment or cancellation actions", () => {
        mocks.orders.data = [{ ...pending, status: 1 }];
        dashboard();
        expect(screen.getByRole("link", { name: "查看开通进度" }).getAttribute("href")).toBe("#/plan/2?order=first-order");
        expect(screen.queryByRole("link", { name: "继续支付" })).toBeNull();
        expect(screen.queryByRole("button", { name: "取消订单" })).toBeNull();
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
    });
    it("keeps deposit orders in their own receipt without promising service activation", () => {
        mocks.orders.data = [{ ...pending, plan_id: 0, plan: null, period: "deposit" }];
        dashboard();
        expect(screen.getByRole("link", { name: "继续支付" }).getAttribute("href")).toBe("#/order/first-order");
        expect(screen.queryByText("继续完成订单即可开通服务，无需重新选择套餐。")).toBeNull();
    });
    it("confirms cancellation and reloads orders and account state before offering plans", async () => {
        mocks.orders.data = [pending];
        mocks.request.mockResolvedValue({ data: true });
        const view = dashboard();
        fireEvent.click(screen.getByRole("button", { name: "取消订单" }));
        expect(mocks.request).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "确认取消订单" }));
        await waitFor(() => expect(mocks.orders.reload).toHaveBeenCalledOnce());
        expect(mocks.request).toHaveBeenCalledWith("user/order/cancel", { trade_no: "first-order" });
        expect(mocks.info.reload).toHaveBeenCalledOnce();
        expect(mocks.sub.reload).toHaveBeenCalledOnce();
        mocks.orders.data = [];
        view.rerender(<UserDashboard />);
        expect(screen.getByRole("link", { name: "选择套餐" })).toBeTruthy();
        expect(screen.queryByRole("link", { name: "继续支付" })).toBeNull();
    });
    it("offers plans only after the order lookup completes successfully", () => {
        Object.assign(mocks.orders, { data: null, loading: true });
        const view = dashboard();
        expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
        Object.assign(mocks.orders, { data: [], loading: false, error: "Orders unavailable" });
        view.rerender(<UserDashboard />);
        expect(screen.getByRole("alert").textContent).toContain("Orders unavailable");
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "重试" }));
        expect(mocks.orders.reload).toHaveBeenCalledOnce();
        expect(mocks.info.reload).toHaveBeenCalledOnce();
        expect(mocks.sub.reload).toHaveBeenCalledOnce();
        mocks.orders.error = "";
        view.rerender(<UserDashboard />);
        expect(screen.getByRole("link", { name: "选择套餐" })).toBeTruthy();
    });
    it("retains known pending orders during a failed refresh", () => {
        Object.assign(mocks.orders, { data: [pending], error: "Refresh failed" });
        dashboard();
        expect(screen.getByRole("alert").textContent).toContain("Refresh failed");
        expect(screen.getByRole("link", { name: "继续支付" })).toBeTruthy();
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
    });
    it.each(["active", "expired", "banned"])("does not fetch orders for %s accounts", async state => {
        mocks.info.data.account_status.state = state;
        render(<Suspense fallback={null}><UserDashboard /></Suspense>);
        if (state === "active") await screen.findByText("active usage");
        expect(mocks.useData.mock.calls.map(([path]) => path)).not.toContain("user/order/fetch");
    });
});
