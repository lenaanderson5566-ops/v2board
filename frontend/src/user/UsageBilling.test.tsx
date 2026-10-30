// @vitest-environment jsdom
vi.mock("../shared/account-copy", () => ({ ac: (key: string) => key }));
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
    orderPaths: [] as string[],
    orderTotal: 0,
    orderLoading: false,
    orderError: "",
    orderRetryAt: 0,
    invite: {} as any,
    info: null as any,
    infoLoading: false,
    infoError: "",
}));
vi.mock("../shared/api", () => ({
    query: (path: string, params: any) =>
        path + "?" + new URLSearchParams(params),
    boot: { mode: "user", currencySymbol: "¥" },
    admin: (s: string) => "admin/" + s,
    request: mocks.request,
    navigate: mocks.navigate,
    clearReadCache: vi.fn(),
    date: (s: number) => String(s),
    bytes: (s: number) => `${s} B`,
    money: (s: number) => `¥${s / 100}`,
}));
vi.mock("../shared/i18n", () => ({
    tx: (s: string, values?: any) =>
        s === "expiresSoon" ? `${s}:${values.days}`
            : s === "resetBusinessZone" ? `${s}:${values.zone}`
            : ["resetAt", "resetPending", "resetFailed"].includes(s) ? `${s}:${values.date}` : s,
    locale: () => "zh-CN",
}));
vi.mock("../shared/credit-copy", () => ({
    c: (key: string) => key,
    minuteDate: (value: unknown) => String(value || "—"),
}));
vi.mock("./pricing-copy", () => ({ pricingCopy: (s: string) => s }));
vi.mock("../shared/billing-copy", () => ({ b: (s: string) => s }));
vi.mock("../shared/experience-copy", () => ({
    e: (s: string, values?: any) =>
        s === "transferAmount" ? `${s}:${values.currency}` : s,
}));
vi.mock("./EmailInvites", () => ({ EmailInvites: () => null }));
vi.mock("./UsageChart", () => ({ UsageChart: () => <div>chart-30-days</div> }));
vi.mock("../shared/ui", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../shared/ui")>()),
    useData: (path: string) => {
        if (path.startsWith("user/order/fetch")) mocks.orderPaths.push(path);
        return {
            data:
                path === "user/usage/reset"
                    ? mocks.resets
                    : path.startsWith("user/order/fetch")
                      ? mocks.orders
                      : path === "user/credit/fetch"
                        ? []
                        : path === "user/info"
                          ? mocks.info
                          : path === "user/invite/fetch"
                            ? mocks.invite
                            : path.includes("Preview")
                              ? { count: 12 }
                              : mocks.subscription,
            reload: mocks.reload,
            loading:
                path === "user/info"
                    ? mocks.infoLoading
                    : path.startsWith("user/order/fetch")
                      ? mocks.orderLoading
                      : false,
            error:
                path === "user/info"
                    ? mocks.infoError
                    : path.startsWith("user/order/fetch")
                      ? mocks.orderError
                      : "",
            total: path.startsWith("user/order/fetch") ? mocks.orderTotal : 0,
            retryAt: path.startsWith("user/order/fetch")
                ? mocks.orderRetryAt
                : 0,
        };
    },
    Empty: ({ text }: any) => <p>{text}</p>,
    Modal: ({ title, children, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>close</button>
            {children}
        </div>
    ),
    Editor: ({ onSave, submit, initial, fields }: any) => (
        <>
            {fields?.map((field: any) => (
                <span key={field.key}>{field.label}</span>
            ))}
            {
                <button
                    onClick={() =>
                        onSave({
                            ...initial,
                            giftcard: "TEST",
                            deposit_amount: 500,
                        })
                    }
                >
                    {submit}
                </button>
            }
        </>
    ),
}));
import { BillingPage } from "./BillingPage";
import { UsagePage } from "./UsagePage";
import { AdminUsageReset } from "../admin/AdminUsageReset";
import { Invite } from "./user";
import { configureTimeZone, setDisplayTimeZone } from "../shared/timezone";
beforeEach(() => {
    configureTimeZone("Asia/Shanghai");
    setDisplayTimeZone("Asia/Shanghai");
    mocks.request.mockReset();
    mocks.reload.mockReset();
    mocks.navigate.mockReset();
    mocks.resets = { available: 2, can_reset: true, credits: [], history: [] };
    mocks.orders = [];
    mocks.orderPaths = [];
    mocks.orderTotal = 0;
    mocks.orderLoading = false;
    mocks.orderError = "";
    mocks.orderRetryAt = 0;
    mocks.invite = { currency: "USD", stat: [2, 0, 0, 10, 500] };
    mocks.infoLoading = false;
    mocks.infoError = "";
    mocks.info = {
        email: "test@example.com",
        balance: 1234,
        credit_balance: 456,
        u: 10,
        d: 20,
        transfer_enable: 100,
        account_status: { state: "active" },
    };
    mocks.subscription = {
        plan: { id: 7, name: "Pro", reset_price: 200 },
        expired_at: 2000000000,
        reset_day: 4,
        has_subscription: true,
    };
});
afterEach(cleanup);
it("explains the business reset zone only when the displayed reset uses a different zone", () => {
    mocks.subscription.reset_at = Date.parse("2026-11-01T00:00:00+08:00") / 1000;
    mocks.subscription.reset_timezone = "Asia/Shanghai";
    setDisplayTimeZone("UTC");
    const view = render(<UsagePage />);
    expect(screen.getByText(`resetAt:${mocks.subscription.reset_at}`)).toBeTruthy();
    expect(screen.getByText("resetBusinessZone:Asia/Shanghai (UTC+08:00)")).toBeTruthy();
    setDisplayTimeZone("Asia/Shanghai");
    view.rerender(<UsagePage />);
    expect(screen.queryByText(/resetBusinessZone/)).toBeNull();
    setDisplayTimeZone("UTC");
    mocks.subscription.reset_at = null;
    view.rerender(<UsagePage />);
    expect(screen.queryByText(/resetBusinessZone/)).toBeNull();
});
it.each([["pending", "resetPending"], ["failed", "resetFailed"]])(
    "shows an unconfirmed reset as %s without claiming the next reset or cleared usage",
    (state, label) => {
        mocks.subscription.reset_at = 1793462400;
        mocks.subscription.reset_timezone = "America/New_York";
        mocks.subscription.reset_state = state;
        render(<UsagePage />);
        expect(screen.getByText(`${label}:1793462400`)).toBeTruthy();
        expect(screen.queryByText(/^resetAt:/)).toBeNull();
        expect(screen.getByText("30 B / 100 B", { exact: false })).toBeTruthy();
    },
);
it("groups subscription, balance and transactions and opens redemption on demand", async () => {
    mocks.request.mockResolvedValue({ data: true });
    render(<BillingPage />);
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText("¥12.34")).toBeTruthy();
    expect(screen.getByText("transactions")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "兑换礼品卡" }));
    fireEvent.change(screen.getByLabelText("礼品卡代码"), {
        target: { value: "TEST" },
    });
    fireEvent.click(screen.getByRole("button", { name: "兑换" }));
    await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe("兑换成功"),
    );
    expect(mocks.request).toHaveBeenCalledWith(
        "user/redeemgiftcard",
        expect.objectContaining({ giftcard: "TEST" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.reload).toHaveBeenCalled();
});
it.each([BillingPage, UsagePage])(
    "keeps unknown credit balances out of %s until account data is recovered",
    (Page) => {
        const loaded = mocks.info;
        mocks.info = null;
        mocks.infoLoading = true;
        const view = render(<Page />);
        expect(screen.queryByText("0 B")).toBeNull();
        expect(screen.queryByRole("button", { name: "buy" })).toBeNull();
        expect(screen.queryByRole("button", { name: "buyMore" })).toBeNull();
        mocks.infoLoading = false;
        mocks.infoError = "account temporarily unavailable";
        view.rerender(<Page />);
        expect(screen.queryByText("0 B")).toBeNull();
        expect(screen.queryByRole("button", { name: "buy" })).toBeNull();
        expect(screen.queryByRole("button", { name: "buyMore" })).toBeNull();
        const retries = screen.getAllByRole("button", { name: "重试" });
        fireEvent.click(retries[retries.length - 1]);
        expect(mocks.reload).toHaveBeenCalledTimes(1);
        mocks.info = loaded;
        mocks.infoError = "";
        view.rerender(<Page />);
        expect(screen.getByText("456 B")).toBeTruthy();
        expect(
            screen.getByRole("button", {
                name: Page === BillingPage ? "buyMore" : "buy",
            }),
        ).toBeTruthy();
    },
);
it.each([BillingPage, UsagePage])(
    "retains a known credit balance and open purchase during refresh and failure in %s",
    (Page) => {
        const view = render(<Page />);
        fireEvent.click(
            screen.getByRole("button", {
                name: Page === BillingPage ? "buyMore" : "buy",
            }),
        );
        const dialog = screen.getByRole("dialog");
        mocks.infoLoading = true;
        view.rerender(<Page />);
        expect(screen.getByText("456 B")).toBeTruthy();
        expect(screen.getByRole("dialog")).toBe(dialog);
        mocks.infoLoading = false;
        mocks.infoError = "refresh temporarily unavailable";
        view.rerender(<Page />);
        expect(screen.getByText("456 B")).toBeTruthy();
        expect(screen.getByRole("dialog")).toBe(dialog);
    },
);
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
        expect.objectContaining({
            plan_id: 0,
            period: "deposit",
            deposit_amount: 500,
        }),
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
    await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith("order/reset-order"),
    );
    expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
        plan_id: 7,
        period: "reset_price",
    });
    expect(mocks.request).not.toHaveBeenCalledWith(
        "user/usage/reset",
        expect.anything(),
    );
});
it("hides paid resets for expired subscriptions", () => {
    mocks.subscription.has_subscription = false;
    render(<UsagePage />);
    expect(screen.queryByRole("button", { name: /paidReset/ })).toBeNull();
});
it("labels credit-only access without presenting the expired historical plan as current", () => {
    mocks.subscription.has_subscription = false;
    mocks.subscription.expired_at = 1;
    const view = render(<UsagePage />);
    const header = view.container.querySelector(".usage-current-plan")!;
    expect(header.textContent).toContain("credits");
    expect(header.textContent).toContain("noPlan");
    expect(header.textContent).not.toContain("Pro");
    expect(
        view.container.querySelector(".usage-quota > strong")?.textContent,
    ).toBe("noPlanTitle");
    expect(
        screen.getByRole("link", { name: /快速开始/ }).getAttribute("href"),
    ).toBe("#/subscribe");
    expect(view.container.querySelector(".usage-renewal-note")).toBeNull();
});
it("shows a restrained renewal notice using the server clock and the current plan", () => {
    mocks.info.account_status.server_time = 1700000000;
    mocks.subscription.expired_at = 1700000000 + 3 * 86400;
    mocks.subscription.plan.renew = 1;
    render(<UsagePage />);
    expect(screen.getByText("expiresSoon:3")).toBeTruthy();
    expect(
        screen.getByRole("link", { name: /续订套餐/ }).getAttribute("href"),
    ).toBe("#/plan/7");
});
it.each([
    { has_subscription: false },
    { expired_at: null },
    { expired_at: 1700000000 },
    { expired_at: 1700000000 + 8 * 86400 },
    { plan: { id: 7, name: "Pro", renew: 0 } },
    { plan: { id: null, name: "Pro", renew: 1 } },
])("does not show a misleading renewal notice for %j", (subscription) => {
    mocks.info.account_status.server_time = 1700000000;
    Object.assign(
        mocks.subscription,
        {
            expired_at: 1700000000 + 86400,
            plan: { id: 7, name: "Pro", renew: 1 },
        },
        subscription,
    );
    const view = render(<UsagePage />);
    expect(view.container.querySelector(".usage-renewal-note")).toBeNull();
});
it("does not estimate an expiry countdown when server time is unavailable", () => {
    mocks.subscription.plan.renew = 1;
    const view = render(<UsagePage />);
    expect(view.container.querySelector(".usage-renewal-note")).toBeNull();
});
it("blocks another paid reset when an unfinished order exists", () => {
    mocks.orders = [{ status: 0, trade_no: "existing" }];
    render(<UsagePage />);
    expect(
        (screen.getByRole("button", { name: /paidReset/ }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
});

it("omits duplicate coupon and usage shortcuts while retaining billing actions", () => {
    render(<BillingPage />);
    expect(screen.queryByRole("link", { name: "我的优惠券" })).toBeNull();
    expect(screen.queryByRole("link", { name: "使用情况" })).toBeNull();
    expect(screen.getByRole("button", { name: "兑换礼品卡" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "账户充值" })).toBeTruthy();
});

it("applies order filters only on submit, searches full server history and resets pagination", () => {
    mocks.orderTotal = 42;
    render(<BillingPage />);
    fireEvent.click(screen.getByText("findTransactions"));
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("timeRange"), {
        target: { value: "90" },
    });
    fireEvent.change(screen.getByLabelText("orderNumber"), {
        target: { value: "invoice_2025-1" },
    });
    expect(mocks.orderPaths.at(-1)).not.toContain("order_number");
    fireEvent.click(screen.getByRole("button", { name: "searchTransactions" }));
    let params = new URLSearchParams(mocks.orderPaths.at(-1)?.split("?")[1]);
    expect(params.get("status")).toBe("3");
    expect(params.get("order_number")).toBe("invoice_2025-1");
    expect(
        Math.abs(
            Date.parse(params.get("created_from")!) -
                (Date.now() - 90 * 86400000),
        ),
    ).toBeLessThan(1000);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(
        new URLSearchParams(mocks.orderPaths.at(-1)?.split("?")[1]).get(
            "current",
        ),
    ).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    params = new URLSearchParams(mocks.orderPaths.at(-1)?.split("?")[1]);
    expect(params.get("current")).toBe("1");
    expect(params.has("status")).toBe(false);
    expect(params.has("order_number")).toBe(false);
    expect(params.has("created_from")).toBe(false);
});
it("keeps all matching rows and a useful empty state rather than filtering only the first five", () => {
    mocks.orders = Array.from({ length: 8 }, (_, index) => ({
        trade_no: `past-${index}`,
        plan: { name: `Historical ${index}` },
        status: 3,
        total_amount: 100,
    }));
    const view = render(<BillingPage />);
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "searchTransactions" }));
    expect(screen.getByText("Historical 7")).toBeTruthy();
    mocks.orders = [];
    view.rerender(<BillingPage />);
    expect(screen.getByText("noMatchingTransactions")).toBeTruthy();
});
it("respects order-list loading and rate-limit cooldown for filters and pagination", () => {
    mocks.orders = Array.from({ length: 6 }, (_, i) => ({
        trade_no: `order-${i}`,
        plan: { name: `Order ${i}` },
        status: 3,
    }));
    mocks.orderTotal = 42;
    const view = render(<BillingPage />);
    fireEvent.click(screen.getByRole("button", { name: "viewAll" }));
    mocks.orderLoading = true;
    view.rerender(<BillingPage />);
    expect(
        (
            screen.getByRole("button", {
                name: "searchTransactions",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    expect(
        (screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    mocks.orderLoading = false;
    mocks.orderRetryAt = Date.now() + 60000;
    view.rerender(<BillingPage />);
    expect(
        (screen.getByRole("button", { name: "retryIn" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    expect(
        (screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    const last = mocks.orderPaths.at(-1);
    fireEvent.submit(
        screen.getByRole("button", { name: "retryIn" }).closest("form")!,
    );
    expect(mocks.orderPaths.at(-1)).toBe(last);
});
it.each(["USD", "CNY"])(
    "labels commission transfer with the immutable %s account currency",
    async (currency) => {
        mocks.invite.currency = currency;
        render(<Invite />);
        fireEvent.click(
            await screen.findByRole("button", { name: "转入余额" }),
        );
        expect(
            await screen.findByText(`transferAmount:${currency}`),
        ).toBeTruthy();
    },
);
