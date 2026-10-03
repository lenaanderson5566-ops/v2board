// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    reload: vi.fn(),
    navigate: vi.fn(),
    resets: {} as any,
    subscription: {} as any,
    orders: [] as any[],
}));
vi.mock("./api", () => ({
    boot: { currencySymbol: "¥" },
    admin: (s: string) => "admin/" + s,
    request: mocks.request,
    navigate: mocks.navigate,
    date: (s: number) => String(s),
    bytes: (s: number) => `${s} B`,
    money: (s: number) => `¥${s / 100}`,
}));
vi.mock("./i18n", () => ({ tx: (s: string) => s }));
vi.mock("./credit-copy", () => ({
    c: (key: string) => key,
    minuteDate: (value: unknown) => String(value || "—"),
}));
vi.mock("./pricing-copy", () => ({ pricingCopy: (s: string) => s }));
vi.mock("./billing-copy", () => ({ b: (s: string) => s }));
vi.mock("./experience-copy", () => ({ e: (s: string) => s }));
vi.mock("./UsageChart", () => ({ UsageChart: () => <div>chart-30-days</div> }));
vi.mock("./ui", () => ({
    useData: (path: string) => ({
        data:
            path === "user/usage/reset"
                ? mocks.resets
                : path === "user/order/fetch"
                  ? mocks.orders
                  : path === "user/info"
                    ? {
                          balance: 1234,
                          u: 10,
                          d: 20,
                          transfer_enable: 100,
                          account_status: { state: "active" },
                      }
                    : path.includes("Preview")
                      ? { count: 12 }
                      : mocks.subscription,
        reload: mocks.reload,
        loading: false,
        error: "",
    }),
    State: ({ children }: any) => children,
    Empty: ({ text }: any) => <p>{text}</p>,
    Modal: ({ title, children, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>close</button>
            {children}
        </div>
    ),
    Editor: ({ onSave, submit, initial }: any) => (
        <button
            onClick={() =>
                onSave({ ...initial, giftcard: "TEST", deposit_amount: 500 })
            }
        >
            {submit}
        </button>
    ),
}));
import { BillingPage } from "./BillingPage";
import { UsagePage } from "./UsagePage";
import { AdminUsageReset } from "./AdminUsageReset";
beforeEach(() => {
    mocks.request.mockReset();
    mocks.reload.mockReset();
    mocks.navigate.mockReset();
    mocks.resets = { available: 2, can_reset: true, credits: [], history: [] };
    mocks.orders = [];
    mocks.subscription = { plan: { id: 7, name: "Pro", reset_price: 200 }, expired_at: 2000000000, reset_day: 4, has_subscription: true };
});
afterEach(cleanup);
it("groups subscription, balance and transactions and opens redemption on demand", async () => {
    mocks.request.mockResolvedValue({ data: true });
    render(<BillingPage />);
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText("¥12.34")).toBeTruthy();
    expect(screen.getByText("transactions")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "兑换礼品卡" }));
    fireEvent.click(screen.getByRole("button", { name: "兑换" }));
    await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe("兑换成功"),
    );
    expect(mocks.request).toHaveBeenCalledWith(
        "user/redeemgiftcard",
        expect.objectContaining({ giftcard: "TEST" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.reload).toHaveBeenCalled();
});
it("keeps recharge on the existing server order and payment flow", async () => {
    mocks.request.mockResolvedValue({ data: "new-order" });
    render(<BillingPage />);
    fireEvent.click(screen.getByRole("button", { name: "账户充值" }));
    fireEvent.click(screen.getByRole("button", { name: "创建充值订单" }));
    await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith("order/new-order"),
    );
    expect(mocks.request).toHaveBeenCalledWith(
        "user/order/save",
        expect.objectContaining({ plan_id: 0, deposit_amount: 500 }),
    );
});
it("expands all transactions and retains order detail links", () => {
    mocks.orders = Array.from({ length: 6 }, (_, i) => ({
        trade_no: `order-${i}`,
        plan: { name: `Plan ${i}` },
        created_at: i,
        total_amount: 100,
        status: 3,
    }));
    render(<BillingPage />);
    expect(screen.queryByText("Plan 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "viewAll" }));
    expect(screen.getByText("Plan 5").closest("a")?.getAttribute("href")).toBe(
        "#/order/order-5",
    );
});
it("separates overview and analysis without removing historical usage", () => {
    render(<UsagePage />);
    expect(screen.queryByText("chart-30-days")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "analysis" }));
    expect(screen.getByText("chart-30-days")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "resetNow" })).toBeNull();
});
it("requires confirmation, prevents double submit and reuses the key on network retry", async () => {
    let reject!: (reason: Error) => void;
    mocks.request.mockImplementationOnce(
        () =>
            new Promise((_, r) => {
                reject = r;
            }),
    );
    render(<UsagePage />);
    fireEvent.click(screen.getByRole("button", { name: "resetNow" }));
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "useOne" }));
    fireEvent.click(screen.getByRole("button", { name: "处理中" }));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const key = mocks.request.mock.calls[0][1].request_key;
    reject(Error("network"));
    await screen.findByRole("alert");
    mocks.request.mockResolvedValue({ data: { outcome: "already_redeemed" } });
    fireEvent.click(screen.getByRole("button", { name: "useOne" }));
    await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe("resetSuccess"),
    );
    expect(mocks.request.mock.calls[1][1].request_key).toBe(key);
    expect(mocks.reload).toHaveBeenCalled();
});
it.each(["reset_inactive", "reset_empty", "reset_no_credit"])(
    "disables ineligible reset: %s",
    (reason) => {
        mocks.resets.can_reset = false;
        mocks.resets.disabled_reason = reason;
        render(<UsagePage />);
        expect(
            (
                screen.getByRole("button", {
                    name: "resetNow",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
    },
);
it("distinguishes grants, personal consumption and administrator global resets", () => {
    mocks.resets.history = [
        { id: 1, kind: "grant", quantity: 2 },
        { id: 2, kind: "use", u_before: 10, d_before: 20 },
        { id: 3, kind: "global", u_before: 0, d_before: 50 },
    ];
    render(<UsagePage />);
    expect(screen.queryByText("globalReset")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "historyLabel" }));
    for (const name of ["granted", "consumed", "globalReset"])
        expect(screen.getByText(name)).toBeTruthy();
});
it("requires typed confirmation for global scope, ignores current filters", async () => {
    mocks.request.mockResolvedValue({ data: { affected: 12 } });
    render(
        <AdminUsageReset
            filters={[{ key: "id", condition: "=", value: 42 }]}
            count={1}
            onComplete={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "全局重置用量" }));
    const button = screen.getByRole("button", {
        name: "确认全局重置",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("输入 RESET ALL USAGE 确认"), {
        target: { value: "RESET ALL USAGE" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    const body = mocks.request.mock.calls[0][1];
    expect(body.kind).toBe("global");
    expect(body.expected_count).toBe(12);
    expect(body.filter).toBeUndefined();
});
it("grants banked credits to the exact selected user filter", async () => {
    mocks.request.mockResolvedValue({ data: { affected: 1 } });
    render(
        <AdminUsageReset
            single
            filters={[{ key: "id", condition: "=", value: 42 }]}
            count={1}
            onComplete={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "发放储备重置" }));
    fireEvent.change(screen.getByLabelText("每人发放次数"), {
        target: { value: 3 },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "确认发放" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "admin/user/usageReset",
            expect.objectContaining({
                kind: "grant",
                quantity: 3,
                expected_count: 1,
                expires_at: null,
                filter: [{ key: "id", condition: "=", value: 42 }],
            }),
        ),
    );
});

it("creates a paid reset order from usage without consuming banked resets", async () => {
    mocks.request.mockResolvedValue({ data: "reset-order" });
    render(<UsagePage />);
    fireEvent.click(screen.getByRole("button", { name: /paidReset/ }));
    expect(screen.queryByText("选择订阅周期")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建订单并继续" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("order/reset-order"));
    expect(mocks.request).toHaveBeenCalledWith("user/order/save", { plan_id: 7, period: "reset_price" });
    expect(mocks.request).not.toHaveBeenCalledWith("user/usage/reset", expect.anything());
});
it("hides paid resets for expired subscriptions", () => {
    mocks.subscription.has_subscription = false;
    render(<UsagePage />);
    expect(screen.queryByRole("button", { name: /paidReset/ })).toBeNull();
});
it("blocks another paid reset when an unfinished order exists", () => {
    mocks.orders = [{ status: 0, trade_no: "existing" }];
    render(<UsagePage />);
    expect((screen.getByRole("button", { name: /paidReset/ }) as HTMLButtonElement).disabled).toBe(true);
});
