// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    act,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    navigate: vi.fn(),
    plans: [] as any[],
    orders: [] as any[],
    sub: {} as any,
    methods: [] as any[],
    detail: {} as any,
    detailLoading: false,
}));
vi.mock("./api", () => ({
    boot: { mode: "user" },
    request: mocks.request,
    navigate: mocks.navigate,
    bytes: (n: number) => `${n} B`,
    money: (value: any) => `¥${(Number(value || 0) / 100).toFixed(2)}`,
    query: (path: string, params: any) =>
        path + "?" + new URLSearchParams(params),
}));
vi.mock("./i18n", () => ({
    tx: (key: string, args: any = {}) =>
        key.replace(/{{(\w+)}}/g, (_, name) => String(args[name])),
}));
vi.mock("./pricing-copy", () => ({
    pricingCopy: (key: string, args: any = {}) => key + JSON.stringify(args),
}));
vi.mock("./import-copy", () => ({}));
vi.mock("./profile-copy", () => ({ p: (key: string) => key }));
vi.mock("./help-copy", () => ({ h: (key: string) => key }));
vi.mock("./credit-copy", () => ({
    c: (key: string) => key,
    minuteDate: (value: unknown) => String(value || "—"),
}));
vi.mock("./billing-copy", () => ({ b: (key: string) => key }));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./ui", () => ({
    useData: (path: string) => ({
        data:
            path === "user/plan/fetch"
                ? mocks.plans
                : path === "user/order/fetch"
                  ? mocks.orders
                  : path === "user/getSubscribe"
                    ? mocks.sub
                    : path.startsWith("user/order/detail")
                      ? mocks.detail
                      : mocks.methods,
        loading: path.startsWith("user/order/detail") && mocks.detailLoading,
        error: "",
        reload: vi.fn(),
    }),
    State: ({ children, loading, data }: any) =>
        loading && data ? <div>{children}</div> : children,
    Panel: ({ children, title, actions }: any) => (
        <section>
            <h2>{title}</h2>
            {actions}
            {children}
        </section>
    ),
    Reload: ({ onClick }: any) => <button onClick={onClick}>刷新</button>,
    Empty: ({ text }: any) => <p>{text}</p>,
    Html: () => null,
    Modal: ({ title, children, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>关闭</button>
            {children}
        </div>
    ),
}));
import { SubscriptionPurchase } from "./SubscriptionPurchase";
import { PaymentCheckout } from "./PaymentCheckout";
import {
    purchasePeriods,
    paymentFee,
    periodSavings,
    subscriptionAction,
} from "./billing-flow";
import { Orders } from "./user";
const plan = {
    id: 1,
    name: "Basic",
    month_price: null,
    quarter_price: 900,
    year_price: 3000,
    reset_price: 100,
    renew: 1,
    show: 1,
    transfer_enable: 50,
};
const order = {
    trade_no: "test-order",
    plan_id: 1,
    plan,
    period: "quarter_price",
    status: 0,
    total_amount: 1000,
    balance_amount: 200,
    discount_amount: 100,
};
beforeEach(() => {
    mocks.request.mockReset();
    mocks.navigate.mockReset();
    mocks.plans = [plan];
    mocks.orders = [];
    mocks.sub = {};
    mocks.detail = { ...order };
    mocks.detailLoading = false;
    mocks.methods = [
        {
            id: 1,
            name: "Card",
            payment: "MGate",
            handling_fee_fixed: 30,
            handling_fee_percent: 2,
        },
        {
            id: 2,
            name: "QR",
            payment: "TestQR",
            handling_fee_fixed: 0,
            handling_fee_percent: 0,
        },
    ];
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});
it("preserves payment selection and QR content while an order refreshes", async () => {
    mocks.request.mockResolvedValue({
        type: 0,
        data: "https://pay.example/preserve",
    });
    const view = render(<Orders tradeNo="test-order" />);
    fireEvent.click(screen.getByRole("radio", { name: /QR/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByDisplayValue("https://pay.example/preserve");
    mocks.detailLoading = true;
    view.rerender(<Orders tradeNo="test-order" />);
    expect(
        screen.getByDisplayValue("https://pay.example/preserve"),
    ).toBeTruthy();
    expect(
        (screen.getByRole("radio", { name: /QR/ }) as HTMLInputElement).checked,
    ).toBe(true);
    mocks.detailLoading = false;
    view.rerender(<Orders tradeNo="test-order" />);
    expect(
        screen.getByDisplayValue("https://pay.example/preserve"),
    ).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("preserves quarterly and zero-priced periods and excludes reset from ordinary purchase", () => {
    expect(purchasePeriods({ ...plan, onetime_price: 0 })).toEqual([
        "quarter_price",
        "year_price",
    ]);
    expect(paymentFee(1000, mocks.methods[0])).toBe(50);
    expect(paymentFee(0, mocks.methods[0])).toBe(0);
    expect(
        paymentFee(999, { handling_fee_percent: 2.5, handling_fee_fixed: 1 }),
    ).toBe(26);
});
it("shows the actual available period and lets users review their selection before creating an order", async () => {
    mocks.request.mockResolvedValue({ data: "created-order" });
    render(<SubscriptionPurchase />);
    expect(screen.getByText("/ 季付")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(screen.queryByRole("radio", { name: /流量重置/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    fireEvent.click(screen.getByText("使用优惠码"));
    fireEvent.change(screen.getByLabelText("优惠码（可选）"), {
        target: { value: " SAVE " },
    });
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "创建订单并继续" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
            plan_id: 1,
            period: "year_price",
            coupon_code: "SAVE",
        }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("order/created-order");
});
it.each([0, 1])(
    "routes an unfinished order with status %s to its existing checkout",
    (status) => {
        mocks.orders = [{ ...order, status, payment_id: 1 }];
        render(<SubscriptionPurchase />);
        expect(
            screen
                .getByRole("link", {
                    name: status === 0 ? "继续支付" : "查看开通进度",
                })
                .getAttribute("href"),
        ).toBe("#/order/test-order");
        expect(
            (
                screen.getByRole("button", {
                    name: "subscribe{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
    },
);
it("keeps hidden renewable plans without a paid reset action in the catalog", () => {
    mocks.sub = {
        plan: { ...plan, id: 9, name: "Existing", show: 0 },
        expired_at: null,
        transfer_enable: 100,
    };
    render(<SubscriptionPurchase />);
    expect(screen.getByRole("heading", { name: "Existing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /流量重置/ })).toBeNull();
});
function checkout(values: any = {}) {
    const reload = vi.fn();
    const view = render(
        <PaymentCheckout
            order={{ ...order, ...values }}
            reload={reload}
            renderCard={() => null}
        />,
    );
    return { ...view, reload };
}
it("selects a method without charging and shows fixed plus percentage fees before confirmation", async () => {
    mocks.request.mockResolvedValue({
        type: 0,
        data: "https://pay.example/qr",
    });
    checkout();
    expect(screen.getByText("¥10.50")).toBeTruthy();
    expect(screen.getByText("合计 ¥10.50")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /QR/ }));
    expect(screen.getAllByText("¥10.00").length).toBeGreaterThan(0);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/checkout", {
            trade_no: "test-order",
            method: 2,
        }),
    );
    expect(screen.getByText("正在等待支付确认，请勿重复付款。")).toBeTruthy();
    expect(screen.queryByText("订单已完成")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "检查支付结果" }));
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("keeps payment status checking available if a previous payment method was removed", () => {
    mocks.methods = [];
    const view = checkout({ payment_id: 99 });
    const button = screen.getByRole("button", { name: "检查支付结果" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(view.reload).toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("closes the card dialog and exposes a failed card charge without claiming success", async () => {
    mocks.methods = [{ id: 3, name: "Stripe", payment: "StripeCredit" }];
    mocks.request.mockRejectedValue(Error("card declined"));
    render(
        <PaymentCheckout
            order={order}
            reload={vi.fn()}
            renderCard={(_, pay) => (
                <button onClick={() => pay("test-card-token")}>
                    模拟提交信用卡
                </button>
            )}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟提交信用卡" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("card declined")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledWith("user/order/checkout", {
        trade_no: "test-order",
        method: 3,
        token: "test-card-token",
    });
});
it("allows zero-due activation even with no payment methods", async () => {
    mocks.methods = [];
    mocks.request.mockResolvedValue({ type: -1, data: true });
    const view = checkout({ total_amount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "确认开通" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/checkout", {
            trade_no: "test-order",
            method: 0,
        }),
    );
    expect(view.reload).toHaveBeenCalled();
    expect(screen.queryByText("订单已完成")).toBeNull();
});
it("does not claim completion on payment acknowledgement and polls the authoritative order status", async () => {
    vi.useFakeTimers();
    mocks.request.mockResolvedValue({ data: 3 });
    const view = checkout({ status: 1 });
    expect(screen.getByText("支付已确认，正在开通")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.request).toHaveBeenCalledWith(
        "user/order/check?trade_no=test-order",
    );
    expect(view.reload).toHaveBeenCalled();
    view.unmount();
    mocks.request.mockClear();
    await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mocks.request).not.toHaveBeenCalled();
});
it("requires an explicit confirmation before cancelling and handles a failed payment", async () => {
    mocks.request
        .mockRejectedValueOnce(Error("gateway unavailable"))
        .mockResolvedValue({ data: true });
    checkout();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByRole("alert");
    expect(screen.getByText("gateway unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消订单" }));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认取消订单" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/cancel", {
            trade_no: "test-order",
        }),
    );
});
it("does not make gateway calls twice during a pending confirmation", async () => {
    let resolve: any;
    mocks.request.mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    checkout();
    const button = screen.getByRole("button", { name: "确认支付" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ type: 0, data: "pay-qr" }));
});
it.each([
    [1, "#/subscribe"],
    [0, "#/order"],
])(
    "links a completed plan_id %s order to the correct next action",
    (planId, href) => {
        checkout({ status: 3, plan_id: planId });
        expect(
            screen
                .getByRole("link", {
                    name: planId === 0 ? "账单" : "快速开始",
                })
                .getAttribute("href"),
        ).toBe(href);
        expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    },
);

it("closed orders omit payment steps and identify cancelled balance refunds", () => {
    render(
        <PaymentCheckout
            order={{ ...order, status: 2 }}
            reload={vi.fn()}
            renderCard={() => null}
        />,
    );
    expect(screen.queryByLabelText("订阅流程")).toBeNull();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    expect(screen.getByText("balanceReturned")).toBeTruthy();
    expect(screen.getByText("quote")).toBeTruthy();
    expect(screen.queryByText("paid")).toBeNull();
});
it("completed credit receipts lead to usage and do not claim a subscription was activated", () => {
    render(
        <PaymentCheckout
            order={{
                ...order,
                status: 3,
                credit_bytes: 1073741824,
                credit_snapshot: { name: "10 GB" },
            }}
            reload={vi.fn()}
            renderCard={() => null}
        />,
    );
    expect(screen.getByText("credited")).toBeTruthy();
    expect(
        screen.getByRole("link", { name: "使用情况" }).getAttribute("href"),
    ).toBe("#/traffic");
    expect(screen.queryByLabelText("订阅流程")).toBeNull();
});
it("one-time-only products are not shown in the subscription catalog", () => {
    mocks.plans = [{ id: 99, name: "CreditOnly", onetime_price: 1000 }];
    render(<SubscriptionPurchase />);
    expect(screen.queryByText("CreditOnly")).toBeNull();
});

it("calculates real savings without inventing discounts", () => {
    expect(
        periodSavings({ month_price: 5880, year_price: 59976 }, "year_price"),
    ).toBe(15);
    expect(
        periodSavings(
            { month_price: 5880, half_year_price: 33516 },
            "half_year_price",
        ),
    ).toBe(5);
    expect(
        periodSavings({ month_price: 0, year_price: 100 }, "year_price"),
    ).toBe(0);
    expect(periodSavings({ year_price: 100 }, "year_price")).toBe(0);
    expect(
        periodSavings({ month_price: 100, year_price: 1300 }, "year_price"),
    ).toBe(0);
});
it("carries the yearly card selection into checkout and removes duplicate metadata", async () => {
    mocks.plans = [
        {
            ...plan,
            month_price: 5880,
            year_price: 59976,
            speed_limit: 0,
            device_limit: 4,
        },
    ];
    mocks.request.mockResolvedValue({ data: "new-order" });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "年付" }));
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(
        (screen.getByRole("radio", { name: /年付/ }) as HTMLInputElement)
            .checked,
    ).toBe(true);
    expect(screen.queryByText("不限速")).toBeNull();
    expect(screen.queryByRole("link", { name: "账单" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建订单并继续" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
            plan_id: 1,
            period: "year_price",
        }),
    );
});

it("defaults mobile details to the current plan and preserves selection when changing cycle", () => {
    mocks.plans = [
        { ...plan, id: 1, name: "Basic" },
        { ...plan, id: 2, name: "Premium" },
    ];
    mocks.sub = { plan_id: 2 };
    const view = render(<SubscriptionPurchase />);
    expect(view.container.querySelector(".mobile-active")?.id).toBe(
        "pricing-plan-2",
    );
    fireEvent.click(screen.getByRole("button", { name: "Basic" }));
    expect(view.container.querySelector(".mobile-active")?.id).toBe(
        "pricing-plan-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "年付" }));
    expect(view.container.querySelector(".mobile-active")?.id).toBe(
        "pricing-plan-1",
    );
    mocks.plans = [{ ...plan, id: 2, name: "Premium" }];
    view.rerender(<SubscriptionPurchase />);
    expect(view.container.querySelector(".mobile-active")?.id).toBe(
        "pricing-plan-2",
    );
});

it("matches purchase wording to backend renewal and switching rules", () => {
    const now = 2000000;
    const active = { plan_id: 1, expired_at: 3000, transfer_enable: 50 };
    expect(subscriptionAction(plan, {}, now)).toBe("subscribe");
    expect(subscriptionAction(plan, active, now)).toBe("renew");
    expect(subscriptionAction({ ...plan, id: 2 }, active, now)).toBe(
        "switchPlan",
    );
    expect(subscriptionAction(plan, { ...active, expired_at: 1000 }, now)).toBe(
        "resubscribe",
    );
    expect(
        subscriptionAction(
            { ...plan, id: 2 },
            { ...active, expired_at: 1000 },
            now,
        ),
    ).toBe("subscribe");
    expect(
        subscriptionAction(
            { ...plan, id: 2 },
            { ...active, expired_at: null },
            now,
        ),
    ).toBe("switchPlan");
    expect(
        subscriptionAction(
            { ...plan, id: 2 },
            { ...active, transfer_enable: 0 },
            now,
        ),
    ).toBe("subscribe");
});

it("renders configured payment icons and keeps fees only in the summary", () => {
    mocks.methods[0].icon = "https://example.com/alipay.png";
    const view = render(
        <PaymentCheckout
            order={order}
            reload={vi.fn()}
            renderCard={() => null}
        />,
    );
    const icon = view.container.querySelector(
        "img.payment-method-icon",
    ) as HTMLImageElement;
    expect(icon.getAttribute("src")).toBe("https://example.com/alipay.png");
    expect(screen.getAllByText("支付手续费")).toHaveLength(1);
    fireEvent.error(icon);
    expect(view.container.querySelector("img.payment-method-icon")).toBeNull();
    expect(
        view.container.querySelectorAll("svg.payment-method-icon"),
    ).toHaveLength(2);
});

it("allows reviewing a replacement and submits its exact order reference atomically", async () => {
    mocks.orders = [{ ...order, payment_id: null }];
    mocks.request.mockResolvedValue({ data: "replacement" });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByRole("note").textContent).toContain("replaceConfirm");
    fireEvent.click(screen.getByRole("button", { name: "创建订单并继续" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
            plan_id: 1,
            period: "quarter_price",
            replace_trade_no: "test-order",
        }),
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
