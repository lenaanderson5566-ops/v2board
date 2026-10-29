// @vitest-environment jsdom
vi.mock("../shared/account-copy", () => ({ ac: (key: string) => key }));
import {
    clearCheckoutPayment,
    pendingCheckoutPayment,
    checkoutOrderReference,
    purchaseReturnPath,
} from "./checkout-navigation";
import { Suspense, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    act,
    within,
    renderHook,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    couponsAvailable: true,
    couponPeriods: [] as string[],
    request: vi.fn(),
    quoteRequest: vi.fn(),
    navigate: vi.fn(),
    plans: [] as any[],
    orders: [] as any[],
    sub: {} as any,
    methods: [] as any[],
    detail: {} as any,
    detailLoading: false,
    subLoading: false,
    subError: "",
    language: "zh-CN",
}));
vi.mock("../shared/api", () => ({
    boot: { mode: "user" },
    request: (path: string, body?: any, options?: any) =>
        path === "user/order/quote"
            ? mocks.quoteRequest(body, options)
            : options === undefined
              ? mocks.request(path, body)
              : mocks.request(path, body, options),
    navigate: mocks.navigate,
    bytes: (n: number) => `${n} B`,
    money: (value: any) => `¥${(Number(value || 0) / 100).toFixed(2)}`,
    query: (path: string, params: any) =>
        path + "?" + new URLSearchParams(params),
}));
vi.mock("../shared/i18n", () => ({
    default: { addResourceBundle: () => undefined },
    locale: () => mocks.language,
    tx: (key: string, args: any = {}) =>
        key.replace(/{{(\w+)}}/g, (_, name) => String(args[name])),
}));
vi.mock("./pricing-copy", () => ({
    pricingCopy: (key: string, args: any = {}) => key + JSON.stringify(args),
}));
vi.mock("./profile-copy", () => ({ p: (key: string) => key }));
vi.mock("./help-copy", () => ({ h: (key: string) => key }));
vi.mock("../shared/credit-copy", () => ({
    c: (key: string) => key,
    minuteDate: (value: unknown) => String(value || "—"),
}));
vi.mock("../shared/billing-copy", () => ({ b: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("../shared/ui", () => ({
    useData: (path: string) => ({
        data:
            path === "user/coupon/wallet"
                ? mocks.couponsAvailable
                    ? [
                          {
                              id: 7,
                              name: "SAVE",
                              discountPercent: 10,
                              expiresAt: "2030-01-01T00:00:00Z",
                              status: "available",
                              planIds: [],
                              billingPeriods: mocks.couponPeriods,
                          },
                      ]
                    : []
                : path === "user/coupon/offers"
                  ? []
                  : path === "user/comm/config"
                    ? { coupons_available: mocks.couponsAvailable }
                    : path === "user/plan/fetch"
                      ? mocks.plans
                      : path === "user/order/fetch"
                        ? mocks.orders
                        : path.startsWith("user/plan/fetch?")
                    ? mocks.plans.find(p => Number(p.id) === Number(new URLSearchParams(path.split("?")[1]).get("id")))
                  : path === "user/getSubscribe"
                          ? mocks.sub
                          : path.startsWith("user/order/detail")
                            ? mocks.detail
                            : mocks.methods,
        loading:
            path === "user/getSubscribe"
                ? mocks.subLoading
                : path.startsWith("user/order/detail") && mocks.detailLoading,
        error: path === "user/getSubscribe" ? mocks.subError : "",
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
import { UnifiedCheckout } from "./UnifiedCheckout";
import { useCheckoutQuote } from "./useCheckoutQuote";
import { PaymentCheckout } from "./PaymentCheckout";
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
    history.replaceState(null, "", "#/plan");
    mocks.couponsAvailable = true;
    mocks.couponPeriods = [];
    mocks.request.mockReset();
    mocks.quoteRequest.mockReset();
    mocks.quoteRequest.mockImplementation(async (body: any) => {
        const chosen = mocks.plans.find((p) => p.id === body.plan_id) || plan;
        const amount = Number(chosen[body.period] || 0);
        const discount = body.wallet_coupon_id ? Math.floor(amount * 0.1) : 0;
        return {
            data: {
                plan_amount: amount,
                discount_amount: discount,
                total_amount: amount - discount,
                balance_amount: 0,
                surplus_amount: 0,
                refund_amount: 0,
                currency: "CNY",
                payment_method_id: body.quote_method,
                payment_amount: amount - discount,
                payment_currency: "CNY",
                handling_amount: 0,
                quote_token:
                    body.quote_method || amount === discount
                        ? "test-quote-" + JSON.stringify(body)
                        : null,
                expires_at: Math.floor(Date.now() / 1000) + 300,
                methods: [
                    {
                        id: 11,
                        name: "Alipay",
                        payment: "TestQR",
                        category: "wallet",
                        quoted_amount: amount - discount,
                        quoted_currency: "CNY",
                        quoted_fee: 0,
                    },
                ],
            },
        };
    });
    mocks.navigate.mockReset();
    mocks.plans = [plan];
    mocks.orders = [];
    mocks.sub = {};
    mocks.subLoading = false;
    mocks.subError = "";
    mocks.language = "zh-CN";
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
    clearCheckoutPayment();
    vi.useRealTimers();
});
it("preserves payment selection and QR content while an order refreshes", async () => {
    mocks.request.mockResolvedValue({
        type: 0,
        data: "https://pay.example/preserve",
    });
    const view = render(
        <Suspense fallback={<p>Loading checkout</p>}>
            <Orders tradeNo="test-order" />
        </Suspense>,
    );
    const qrMethod = await screen.findByRole("radio", { name: /QR/ });
    await waitFor(() =>
        expect(
            (screen.getByRole("radio", { name: /Card/ }) as HTMLInputElement)
                .checked,
        ).toBe(true),
    );
    fireEvent.click(qrMethod);
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByDisplayValue("https://pay.example/preserve");
    mocks.detailLoading = true;
    view.rerender(
        <Suspense fallback={<p>Loading checkout</p>}>
            <Orders tradeNo="test-order" />
        </Suspense>,
    );
    expect(
        screen.getByDisplayValue("https://pay.example/preserve"),
    ).toBeTruthy();
    expect(
        (screen.getByRole("radio", { name: /QR/ }) as HTMLInputElement).checked,
    ).toBe(true);
    mocks.detailLoading = false;
    view.rerender(
        <Suspense fallback={<p>Loading checkout</p>}>
            <Orders tradeNo="test-order" />
        </Suspense>,
    );
    expect(
        screen.getByDisplayValue("https://pay.example/preserve"),
    ).toBeTruthy();
    expect(
        mocks.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(1);
});

it("shows the actual available period and lets users review their selection before creating an order", async () => {
    mocks.request.mockResolvedValue({ data: "created-order" });
    render(<SubscriptionPurchase />);
    expect(screen.getByText("/ 季付")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(screen.queryByRole("radio", { name: /流量重置/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    fireEvent.click(
        screen.getByLabelText("我的优惠券", { selector: "summary" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /SAVE/ }));
    await screen.findByText("−¥3.00");
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    expect(screen.getByText("优惠金额")).toBeTruthy();
    expect(screen.getByText("amountDue{}")).toBeTruthy();
    expect(screen.getByText("−¥3.00")).toBeTruthy();
    expect(screen.getByText("¥27.00")).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "user/order/save",
            expect.objectContaining({
                plan_id: 1,
                period: "year_price",
                wallet_coupon_id: 7,
            }),
        ),
    );
    expect(location.hash).toBe("#/plan/1?order=created-order");
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
    expect(screen.getAllByText("¥10.50")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("radio", { name: /QR/ }));
    expect(screen.getAllByText("¥10.00").length).toBeGreaterThan(0);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "user/order/checkout",
            expect.objectContaining({
                trade_no: "test-order",
                method: 2,
                payment_request_key: expect.any(String),
            }),
            { timeoutMs: 45000 },
        ),
    );
    expect(screen.getByText("正在等待支付确认，请勿重复付款。")).toBeTruthy();
    expect(screen.queryByText("订单已完成")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "检查支付结果" }));
    expect(
        mocks.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(1);
});
it("keeps payment status checking available if a previous payment method was removed", () => {
    mocks.methods = [];
    const view = checkout({ payment_id: 99 });
    const button = screen.getByRole("button", { name: "检查支付结果" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(view.reload).toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith(
        "user/order/check?trade_no=test-order",
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
});
it("uses the fee locked in an issued order even when provider settings change", async () => {
    mocks.request.mockResolvedValue({ data: 0 });
    checkout({ payment_id: 1, handling_amount: 75 });
    expect(screen.getByText("¥10.75")).toBeTruthy();
    expect(
        screen.getByRole("radio", { name: /Card/ }).matches(":disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新发起支付" }));
    fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
            name: "重新发起支付",
        }),
    );
    expect(await screen.findByText("¥10.50")).toBeTruthy();
    expect(
        screen.getByRole("radio", { name: /Card/ }).matches(":disabled"),
    ).toBe(false);
    expect(
        mocks.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(0);
});
it("hides zero fees and preserves deposit bonus amounts from the server", () => {
    mocks.methods = [mocks.methods[1]];
    checkout({
        plan_id: 0,
        total_amount: 10000,
        bounus: 2000,
        get_amount: 12000,
        balance_amount: 0,
        discount_amount: 0,
    });
    expect(screen.queryByText("支付手续费")).toBeNull();
    expect(screen.getByText("到账金额 ¥120.00")).toBeTruthy();
    expect(screen.queryByLabelText("订阅流程")).toBeNull();
});
it("shows only a refresh action for unknown order states", () => {
    const view = checkout({ status: -1 });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(view.reload).toHaveBeenCalledOnce();
});
it("replaces a QR checkout with its receipt when the authoritative status completes", async () => {
    mocks.request.mockResolvedValue({
        type: 0,
        data: "https://pay.example/finish",
    });
    const view = checkout();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByDisplayValue("https://pay.example/finish");
    view.rerender(
        <PaymentCheckout
            order={{ ...order, status: 3, handling_amount: 50 }}
            reload={view.reload}
            renderCard={() => null}
        />,
    );
    expect(screen.getByRole("heading", { name: "订单已完成" })).toBeTruthy();
    expect(screen.queryByDisplayValue("https://pay.example/finish")).toBeNull();
    expect(screen.queryByRole("button", { name: "检查支付结果" })).toBeNull();
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
    await screen.findAllByRole("alert");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("card declined").length).toBeGreaterThan(0);
    expect(mocks.request).toHaveBeenCalledWith(
        "user/order/checkout",
        expect.objectContaining({
            trade_no: "test-order",
            method: 3,
            token: "test-card-token",
            payment_request_key: expect.any(String),
        }),
        { timeoutMs: 45000 },
    );
});
it("allows zero-due activation even with no payment methods", async () => {
    mocks.methods = [];
    mocks.request.mockResolvedValue({ type: -1, data: true });
    const view = checkout({ total_amount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "确认开通" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "user/order/checkout",
            expect.objectContaining({
                trade_no: "test-order",
                method: 0,
                payment_request_key: expect.any(String),
            }),
            { timeoutMs: 45000 },
        ),
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
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
    await screen.findAllByRole("alert");
    expect(screen.getByText("gateway unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消订单" }));
    expect(
        mocks.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(1);
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
    expect(
        mocks.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(1);
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
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "user/order/save",
            expect.objectContaining({
                plan_id: 1,
                period: "year_price",
            }),
        ),
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

it("renders built-in payment icons from the API host", () => {
    mocks.methods[0].icon = "/payment-icons/alipay.svg";
    const previous = window.V2BOARD;
    window.V2BOARD = { ...previous, apiBaseUrl: "https://api.example.com" };
    try {
        const view = render(
            <PaymentCheckout
                order={order}
                reload={vi.fn()}
                renderCard={() => null}
            />,
        );
        expect(
            view.container
                .querySelector("img.payment-method-icon")
                ?.getAttribute("src"),
        ).toBe("https://api.example.com/payment-icons/alipay.svg");
    } finally {
        window.V2BOARD = previous;
    }
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
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "user/order/save",
            expect.objectContaining({
                plan_id: 1,
                period: "quarter_price",
                replace_trade_no: "test-order",
            }),
        ),
    );
    expect(
        mocks.request.mock.calls.filter(([path]) => path === "user/order/save"),
    ).toHaveLength(1);
});

it("shows the historical plan price on completed receipts", async () => {
    const { OrderReceipt } = await import("./OrderReceipt");
    render(
        <OrderReceipt
            order={{
                status: 3,
                plan_id: 1,
                period: "month_price",
                total_amount: 3880,
                balance_amount: 2000,
                plan: { name: "Ultimate", month_price: 99999 },
            }}
        />,
    );
    expect(screen.getByText("套餐价格")).toBeTruthy();
    expect(screen.getByText("¥58.80")).toBeTruthy();
    expect(screen.getByText("¥38.80")).toBeTruthy();
});

it.each([
    ["quarter_price", "季付", 3],
    ["half_year_price", "半年付", 6],
    ["year_price", "年付", 12],
    ["two_year_price", "两年付", 24],
    ["three_year_price", "三年付", 36],
])(
    "shows monthly equivalent and savings consistently for %s",
    (period, label, months) => {
        mocks.plans = [
            { ...plan, month_price: 10000, [period]: Number(months) * 9500 },
        ];
        render(<SubscriptionPurchase />);
        fireEvent.click(screen.getByRole("button", { name: String(label) }));
        expect(screen.getByText('equivalent{"price":"¥95.00"}')).toBeTruthy();
        expect(screen.getByText('savingBadge{"percent":5}')).toBeTruthy();
    },
);
it("shows monthly equivalent without inventing savings when no monthly price exists", () => {
    mocks.plans = [{ id: 1, name: "Half year", half_year_price: 18000 }];
    render(<SubscriptionPurchase />);
    expect(screen.getByText('equivalent{"price":"¥30.00"}')).toBeTruthy();
    expect(document.querySelector(".pricing-saving")).toBeNull();
});

it("hides coupon controls when no enabled usable coupons exist", () => {
    mocks.couponsAvailable = false;
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(screen.queryByText("使用优惠码")).toBeNull();
    expect(screen.queryByLabelText("优惠码（可选）")).toBeNull();
});

it("compares configured quota and limits without implying unlimited or monthly data", () => {
    mocks.plans = [{ ...plan, device_limit: 3, speed_limit: 100 }];
    const view = render(<SubscriptionPurchase />);
    expect(screen.getByText("53687091200 B")).toBeTruthy();
    expect(screen.getByText('speedValue{"value":100}')).toBeTruthy();
    expect(screen.getByText("deviceLimit")).toBeTruthy();
    expect(screen.getByText("total{}")).toBeTruthy();
    mocks.plans = [
        { ...plan, transfer_enable: null, device_limit: null, speed_limit: 0 },
    ];
    view.rerender(<SubscriptionPurchase />);
    expect(document.querySelector(".pricing-specs")?.children.length).toBe(0);
    expect(screen.queryByText("不限速")).toBeNull();
    expect(screen.queryByText("不限设备数")).toBeNull();
});
it.each(["loading", "error"])(
    "waits for authoritative subscription state before selection (%s)",
    (state) => {
        mocks.subLoading = state === "loading";
        mocks.subError =
            state === "error" ? "Subscription temporarily unavailable" : "";
        render(<SubscriptionPurchase />);
        const action = screen.getByRole("button", { name: "subscribe{}" });
        expect(action.matches(":disabled")).toBe(true);
        fireEvent.click(action);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(mocks.request).not.toHaveBeenCalled();
    },
);
it("initially shows an available plan on mobile instead of a sold-out first plan", () => {
    mocks.plans = [
        { ...plan, capacity_limit: 0 },
        { ...plan, id: 2, name: "Available", capacity_limit: 5 },
    ];
    render(<SubscriptionPurchase />);
    expect(document.querySelector(".mobile-active")?.id).toBe("pricing-plan-2");
    fireEvent.click(
        within(screen.getByRole("group", { name: "选择套餐" })).getByRole(
            "button",
            { name: "Basic" },
        ),
    );
    expect(document.querySelector(".mobile-active")?.id).toBe("pricing-plan-1");
    expect(
        screen.getByRole("button", { name: "暂时售罄" }).matches(":disabled"),
    ).toBe(true);
});
it("puts the connection action before receipt details after successful payment", () => {
    checkout({ status: 3 });
    const action = screen.getByRole("link", { name: "快速开始" });
    const receipt = document.querySelector(".receipt-card")!;
    expect(action.getAttribute("href")).toBe("#/subscribe");
    expect(
        action.compareDocumentPosition(receipt) &
            Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
});

it.each([
    { periods: [], optOut: false, discount: true },
    { periods: ["quarterly"], optOut: false, discount: false },
    { periods: [], optOut: true, discount: false },
])(
    "preserves valid choices across cycle changes without submitting an incompatible coupon: %j",
    async ({ periods, optOut, discount }) => {
        mocks.couponPeriods = periods;
        mocks.request.mockResolvedValue({ data: "created-order" });
        render(<SubscriptionPurchase />);
        fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
        fireEvent.click(
            screen.getByLabelText("我的优惠券", { selector: "summary" }),
        );
        fireEvent.click(screen.getByRole("radio", { name: /SAVE/ }));
        if (optOut) {
            fireEvent.click(
                screen.getByLabelText("我的优惠券", { selector: "summary" }),
            );
            fireEvent.click(
                screen.getByRole("radio", { name: "不使用优惠券" }),
            );
        }
        fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
        await waitFor(() =>
            expect(
                screen.getByText(discount ? "¥27.00" : "¥30.00", {
                    selector: ".purchase-footer-total strong",
                }),
            ).toBeTruthy(),
        );
        if (!discount) {
            fireEvent.click(screen.getByRole("radio", { name: /季付/ }));
            await waitFor(() =>
                expect(
                    screen.getByText("¥9.00", {
                        selector: ".purchase-footer-total strong",
                    }),
                ).toBeTruthy(),
            );
            fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
        }
        await waitFor(() =>
            expect(
                (
                    screen.getByRole("button", {
                        name: "confirmAndPay{}",
                    }) as HTMLButtonElement
                ).disabled,
            ).toBe(false),
        );
        expect(screen.getByText("Basic · 年付")).toBeTruthy();
        expect(screen.getByText("amountDue{}")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "confirmAndPay{}" }),
        );
        await waitFor(() =>
            expect(mocks.request).toHaveBeenCalledWith(
                "user/order/save",
                expect.objectContaining({
                    plan_id: 1,
                    period: "year_price",
                    ...(discount ? { wallet_coupon_id: 7 } : {}),
                }),
            ),
        );
    },
);

it("does not create an order while the server quote is pending", async () => {
    mocks.quoteRequest.mockReturnValue(new Promise(() => {}));
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(
        (
            screen.getByRole("button", {
                name: "confirmAndPay{}",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("keeps crypto network selection explicit instead of restoring the default wallet", async () => {
    const quote = mocks.quoteRequest.getMockImplementation()!;
    mocks.quoteRequest.mockImplementation(async (body: any) => {
        const result = await quote(body);
        return { data: { ...result.data, methods: [
            ...result.data.methods,
            { id: 12, name: "TRON channel", category: "crypto", asset: "USDT", network: "tron", network_name: "TRON (TRC20)" },
            { id: 13, name: "BSC channel", category: "crypto", asset: "USDT", network: "bsc", network_name: "BNB Smart Chain (BEP20)" },
        ] } };
    });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "confirmAndPay{}" });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "USDT" }));
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    await waitFor(() => expect(mocks.quoteRequest.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ period: "year_price", quote_method: 0 }),
    ));
    expect((screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement).checked).toBe(false);
    expect(confirm.disabled).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /BNB Smart Chain/ }));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect((screen.getByRole("radio", { name: /BNB Smart Chain/ }) as HTMLInputElement).checked).toBe(true);
    expect(mocks.quoteRequest.mock.calls.at(-1)?.[0].quote_method).toBe(13);
    expect(mocks.request).not.toHaveBeenCalled();
});
it("ignores an obsolete quote after changing cycles", async () => {
    const quote = mocks.quoteRequest.getMockImplementation()!;
    let finish: (value: any) => void = () => {};
    mocks.quoteRequest.mockImplementation((body: any) =>
        body.period === "year_price"
            ? new Promise((resolve) => {
                  finish = resolve;
              })
            : quote(body),
    );
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    fireEvent.click(screen.getByRole("radio", { name: /季付/ }));
    await screen.findByText("¥9.00", {
        selector: ".purchase-footer-total strong",
    });
    finish(await quote({ plan_id: 1, period: "year_price", quote_method: 11 }));
    await waitFor(() =>
        expect(
            screen.getByText("¥9.00", {
                selector: ".purchase-footer-total strong",
            }),
        ).toBeTruthy(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
});
it("retries an uncertain order using exactly the same quote and idempotency key", async () => {
    mocks.request
        .mockRejectedValueOnce(
            Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" }),
        )
        .mockResolvedValue({ data: "recovered-order" });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(
        screen.getByRole("radio", { name: /年付/ }).matches(":disabled"),
    ).toBe(true);
    fireEvent.click(retry);
    await waitFor(() =>
        expect(location.hash).toBe("#/plan/1?order=recovered-order"),
    );
    const saves = mocks.request.mock.calls.filter(
        ([path]) => path === "user/order/save",
    );
    expect(saves).toHaveLength(2);
    expect(saves[0][1]).toEqual(saves[1][1]);
    expect(saves[0][1].checkout_request_key).toMatch(/^[a-f0-9-]{36}$/);
});
it("re-quotes a conflict and waits for explicit confirmation before resubmitting", async () => {
    mocks.request
        .mockImplementationOnce(async () => {
            mocks.plans[0] = { ...plan, quarter_price: 1200 };
            throw Object.assign(new Error("Quote changed"), { status: 409 });
        })
        .mockResolvedValue({ data: "updated-order" });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    await screen.findByText("¥30.00", { selector: ".purchase-footer-total strong" });
    const requestsBeforeReturn = mocks.quoteRequest.mock.calls.length;
    fireEvent.click(screen.getByRole("radio", { name: /季付/ }));
    expect(screen.getByText("¥9.00", { selector: ".purchase-footer-total strong" })).toBeTruthy();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(requestsBeforeReturn);
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    await screen.findByText("¥12.00", {
        selector: ".purchase-footer-total strong",
    });
    expect(
        mocks.request.mock.calls.filter(([path]) => path === "user/order/save"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    await waitFor(() =>
        expect(location.hash).toBe("#/plan/1?order=updated-order"),
    );
});
it("starts a confirmed payment once under StrictMode using its request key", async () => {
    mocks.methods = [
        {
            id: 11,
            name: "Alipay",
            payment: "TestQR",
            quoted_amount: 1000,
            quoted_currency: "CNY",
            quoted_fee: 0,
        },
    ];
    mocks.request.mockResolvedValue({ type: 2, data: true });
    render(
        <StrictMode>
            <PaymentCheckout
                order={{ ...order, balance_amount: 0, discount_amount: 0 }}
                reload={vi.fn()}
                renderCard={() => null}
                initialPayment={{
                    methodId: 11,
                    amount: 1000,
                    currency: "CNY",
                    requestKey: "e499b094-a7a7-4d71-abd9-f7cc60f00001",
                }}
            />
        </StrictMode>,
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.request).toHaveBeenCalledWith(
        "user/order/checkout",
        expect.objectContaining({
            method: 11,
            expected_payment_amount: 1000,
            expected_payment_currency: "CNY",
            payment_request_key: "e499b094-a7a7-4d71-abd9-f7cc60f00001",
        }),
        { timeoutMs: 45000 },
    );
});

it("keeps the confirmed order inside checkout and does not navigate to billing", async () => {
    mocks.request.mockResolvedValue({ data: "routed-order" });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    expect(mocks.navigate).toHaveBeenCalledWith(
        expect.stringMatching(/^plan\/1\?period=quarter_price/),
    );
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "confirmAndPay{}" }));
    await waitFor(() =>
        expect(location.hash).toBe("#/plan/1?order=routed-order"),
    );
    expect(pendingCheckoutPayment("routed-order")).toBeUndefined();
    expect(mocks.navigate.mock.calls.some(([path]) => path.startsWith("order/"))).toBe(false);
    expect(pendingCheckoutPayment("another-order")).toBeUndefined();
    clearCheckoutPayment();
    expect(pendingCheckoutPayment("routed-order")).toBeUndefined();
});
it("recovers the methods list after a selected channel becomes unavailable", async () => {
    const quote = mocks.quoteRequest.getMockImplementation()!;
    let unavailable = false;
    mocks.quoteRequest.mockImplementation((body: any) => {
        if (unavailable && body.quote_method === 11)
            return Promise.reject(Object.assign(new Error("Channel unavailable"), { status: 409 }));
        return Promise.resolve(quote(body)).then((result: any) =>
            unavailable
                ? {
                      data: {
                          ...result.data,
                          methods: [
                              {
                                  ...result.data.methods[0],
                                  id: 12,
                                  name: "Spare",
                              },
                          ],
                      },
                  }
                : result,
        );
    });
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "confirmAndPay{}",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
    unavailable = true;
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    await screen.findByText("Channel unavailable");
    fireEvent.click(screen.getByRole("button", { name: "reselectPayment{}" }));
    await waitFor(() =>
        expect(
            mocks.quoteRequest.mock.calls.some(
                ([body]) =>
                    body.period === "year_price" && body.quote_method === 0,
            ),
        ).toBe(true),
    );
    await waitFor(() =>
        expect(
            (screen.getByRole("radio", { name: "Spare" }) as HTMLInputElement)
                .checked,
        ).toBe(true),
    );
    expect(mocks.request).not.toHaveBeenCalled();
});
it.each([0, 1])("recovers an existing order before quoting a direct checkout (status %s)", (status) => {
    mocks.orders = [{ ...order, status, payment_id: 1 }];
    render(<UnifiedCheckout initialPlan={plan} />);
    expect(screen.getByRole("button", { name: status === 1 ? "查看开通进度" : "继续支付" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "confirmAndPay{}" })).toBeNull();
    expect(mocks.quoteRequest).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("does not loop between the selected method and default after a quote conflict", async () => {
    vi.useFakeTimers();
    try {
        const quote = mocks.quoteRequest.getMockImplementation()!;
        mocks.quoteRequest.mockImplementation((body: any) => body.quote_method
            ? Promise.reject(Object.assign(new Error("Existing order"), { status: 409 })) : quote(body));
        render(<SubscriptionPurchase />);
        fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
        expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
        expect(screen.getAllByText("Existing order")).toHaveLength(1);
        expect(screen.getByRole("link", { name: "查看订单记录" })).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
        expect(mocks.request).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
});
it("honors quote rate-limit cooldown across input changes and explicit retries", async () => {
    vi.useFakeTimers();
    try {
        mocks.quoteRequest.mockRejectedValue(Object.assign(new Error("操作过于频繁，请稍后重试。"), { status: 429, retryAfter: 3 }));
        render(<SubscriptionPurchase />);
        fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
        expect(mocks.quoteRequest).toHaveBeenCalledTimes(1);
        expect((screen.getByRole("button", { name: /retryIn/ }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
        await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
        expect(mocks.quoteRequest).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "重试" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
        expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
        expect(mocks.quoteRequest.mock.calls.at(-1)?.[0].period).toBe("year_price");
        expect(mocks.request).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
});

const cachedSelection = { plan_id: 1, period: "quarter_price", quote_method: 11 };
const settleCachedQuote = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
it("instantly reuses a successful quote on a return selection without another request", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
        initialProps: { selection: cachedSelection },
    });
    await settleCachedQuote();
    const original = result.current.data;
    rerender({ selection: { ...cachedSelection, period: "year_price" } });
    await settleCachedQuote();
    expect(result.current.data?.payment_amount).toBe(3000);
    rerender({ selection: cachedSelection });
    expect(result.current.data).toBe(original);
    expect(result.current.loading).toBe(false);
    await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
    expect(mocks.request).not.toHaveBeenCalled();
});
it.each([{ lifetime: 300, elapsed: 31_000 }, { lifetime: 7, elapsed: 2100 }])(
    "refreshes a returned quote after cache or token safety expiry: %j", async ({ lifetime, elapsed }) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
        const quote = mocks.quoteRequest.getMockImplementation()!;
        mocks.quoteRequest.mockImplementation(async (body: any) => {
            const result = await quote(body);
            return { data: { ...result.data, expires_at: Math.floor(Date.now() / 1000) + lifetime } };
        });
        const { result, rerender } = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
            initialProps: { selection: cachedSelection },
        });
        await settleCachedQuote();
        rerender({ selection: { ...cachedSelection, period: "year_price" } });
        await settleCachedQuote();
        await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
        rerender({ selection: cachedSelection });
        expect(result.current.data).toBeUndefined();
        expect(result.current.loading).toBe(true);
        await settleCachedQuote();
        expect(mocks.quoteRequest).toHaveBeenCalledTimes(3);
        expect(result.current.data?.payment_amount).toBe(900);
    },
);
it("does not extend the cache lifetime when a quote is reused", async () => {
    vi.useFakeTimers();
    const annual = { ...cachedSelection, period: "year_price" };
    const { rerender } = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
        initialProps: { selection: cachedSelection },
    });
    await settleCachedQuote();
    rerender({ selection: annual }); await settleCachedQuote();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    rerender({ selection: cachedSelection }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    rerender({ selection: annual }); await settleCachedQuote();
    rerender({ selection: cachedSelection }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(4);
});
it("separates quotes by complete selection, currency and language", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ selection, currency }) => useCheckoutQuote(true, selection, currency), {
        initialProps: { selection: cachedSelection as any, currency: "CNY" },
    });
    await settleCachedQuote();
    for (const selection of [
        { ...cachedSelection, period: "year_price" },
        { ...cachedSelection, quote_method: 12 },
        { ...cachedSelection, wallet_coupon_id: 7 },
        { ...cachedSelection, replace_trade_no: "owned-old-order" },
        { ...cachedSelection, plan_id: 2 },
    ]) { rerender({ selection, currency: "CNY" }); await settleCachedQuote(); }
    rerender({ selection: cachedSelection, currency: "USD" }); await settleCachedQuote();
    mocks.language = "en-US";
    rerender({ selection: cachedSelection, currency: "CNY" }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(8);
    mocks.language = "zh-CN";
    rerender({ selection: cachedSelection, currency: "CNY" }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(8);
});
it("bypasses cached quotes on explicit refresh and rejects late responses after asset changes", async () => {
    vi.useFakeTimers();
    const quote = mocks.quoteRequest.getMockImplementation()!;
    const { result, rerender } = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
        initialProps: { selection: cachedSelection },
    });
    await settleCachedQuote();
    act(() => result.current.reload());
    expect(result.current.data).toBeUndefined();
    await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
    let oldResponse!: (value: any) => void;
    mocks.quoteRequest.mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; }));
    const annual = { ...cachedSelection, period: "year_price" };
    rerender({ selection: annual }); await settleCachedQuote();
    act(() => window.dispatchEvent(new Event("data-changed")));
    expect(result.current.data).toBeUndefined();
    await settleCachedQuote();
    await act(async () => oldResponse({ data: { ...(await quote(annual)).data, payment_amount: 1 } }));
    expect(result.current.data?.payment_amount).toBe(3000);
    rerender({ selection: cachedSelection }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(5);
    expect(result.current.data?.payment_amount).toBe(900);
});
it.each([409, 500])("clears all cached combinations after quote failure %s", async status => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
        initialProps: { selection: cachedSelection },
    });
    await settleCachedQuote();
    mocks.quoteRequest.mockRejectedValueOnce(Object.assign(new Error("Changed"), { status }));
    rerender({ selection: { ...cachedSelection, period: "year_price" } }); await settleCachedQuote();
    rerender({ selection: cachedSelection }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(3);
});
it("does not use an older cache entry to bypass a rate-limit cooldown", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
        initialProps: { selection: cachedSelection },
    });
    await settleCachedQuote();
    mocks.quoteRequest.mockRejectedValueOnce(Object.assign(new Error("Limited"), { status: 429, retryAfter: 3 }));
    rerender({ selection: { ...cachedSelection, period: "year_price" } }); await settleCachedQuote();
    rerender({ selection: cachedSelection }); await settleCachedQuote();
    expect(result.current.data).toBeUndefined();
    expect(result.current.status).toBe(429);
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    act(() => result.current.reload()); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(3);
});
it("releases page quotes on unmount and stops reuse and requests after session expiry", async () => {
    vi.useFakeTimers();
    const first = renderHook(() => useCheckoutQuote(true, cachedSelection));
    await settleCachedQuote(); first.unmount();
    const next = renderHook(({ selection }) => useCheckoutQuote(true, selection), {
        initialProps: { selection: cachedSelection },
    });
    await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event("auth-expired")));
    expect(next.result.current.data).toBeUndefined();
    next.rerender({ selection: { ...cachedSelection, period: "year_price" } });
    await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(2);
});
it("limits retained combinations while keeping recently used quotes reusable", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ coupon }) => useCheckoutQuote(true, { ...cachedSelection, wallet_coupon_id: coupon }), {
        initialProps: { coupon: 1 },
    });
    await settleCachedQuote();
    for (let coupon = 2; coupon <= 11; coupon++) { rerender({ coupon }); await settleCachedQuote(); }
    rerender({ coupon: 2 }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(11);
    rerender({ coupon: 1 }); await settleCachedQuote();
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(12);
});

it("keeps price and payment content mounted while a new quote is pending, without allowing stale payment", async () => {
    const quote = mocks.quoteRequest.getMockImplementation()!;
    let finish!: (value: any) => void;
    mocks.quoteRequest.mockImplementation((body: any) => body.period === "year_price"
        ? new Promise(resolve => { finish = resolve; }) : quote(body));
    const view = render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "confirmAndPay{}" });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    const methods = view.container.querySelector(".payment-method-picker");
    const status = view.container.querySelector(".checkout-quote-status");
    const lines = view.container.querySelector(".purchase-breakdown .checkout-lines");
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    await waitFor(() => expect(mocks.quoteRequest.mock.calls.at(-1)?.[0].period).toBe("year_price"));
    expect(screen.getByText("¥9.00", { selector: ".purchase-footer-total strong" })).toBeTruthy();
    expect(screen.getByText("Basic · 季付")).toBeTruthy();
    expect(screen.getAllByText("previousQuote{}")).toHaveLength(2);
    expect(lines?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toBe("quoteLoading{}");
    expect(view.container.querySelector(".payment-method-picker")).toBe(methods);
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(confirm.closest("form")!);
    expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => finish(await quote({ plan_id: 1, period: "year_price", quote_method: 11 })));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(screen.getByText("¥30.00", { selector: ".purchase-footer-total strong" })).toBeTruthy();
    expect(screen.getByText("Basic · 年付")).toBeTruthy();
    expect(screen.queryByText("previousQuote{}")).toBeNull();
    expect(lines?.getAttribute("aria-busy")).toBe("false");
    expect(view.container.querySelector(".checkout-quote-status")).toBe(status);
    expect(view.container.querySelector(".payment-method-picker")).toBe(methods);
});
it("labels the retained amount as previous and blocks confirmation after recalculation fails", async () => {
    const quote = mocks.quoteRequest.getMockImplementation()!;
    mocks.quoteRequest.mockImplementation((body: any) => body.period === "year_price"
        ? Promise.reject(Object.assign(new Error("Quote unavailable"), { status: 503 })) : quote(body));
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", { name: "subscribe{}" }));
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "confirmAndPay{}" });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(screen.getByRole("radio", { name: /年付/ }));
    await screen.findByText("Quote unavailable");
    expect(screen.getByText("¥9.00", { selector: ".purchase-footer-total strong" })).toBeTruthy();
    expect(screen.getAllByText("previousQuote{}")).toHaveLength(2);
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(confirm.closest("form")!);
    expect(mocks.request).not.toHaveBeenCalled();
});

it("creates an order and starts its QR payment in place once under StrictMode, then resumes without charging again", async () => {
    mocks.detail = { ...order, trade_no: "inline-order", total_amount: 810, balance_amount: 0, discount_amount: 90 };
    mocks.methods = [{ id: 11, name: "Alipay", payment: "TestQR", category: "wallet", quoted_amount: 810, quoted_currency: "CNY", quoted_fee: 0 }];
    mocks.request.mockImplementation(async (path: string) => path === "user/order/save"
        ? { data: "inline-order" } : path === "user/order/checkout" ? { type: 0, data: "https://pay.example/inline-qr" } : { data: 0 });
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const view = render(<StrictMode><UnifiedCheckout initialPlan={plan} /></StrictMode>);
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "confirmAndPay{}" });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(view.container.querySelector(".checkout-coupon summary")!);
    fireEvent.click(await screen.findByRole("radio", { name: /SAVE/ }));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    const originalForm = confirm.closest("form");
    const originalCycles = screen.getByRole("group", { name: "选择订阅周期" });
    const quoteRequests = mocks.quoteRequest.mock.calls.length;
    fireEvent.click(confirm);
    const qrContent = await screen.findByDisplayValue("https://pay.example/inline-qr");
    expect((qrContent as HTMLInputElement).value).toBe("https://pay.example/inline-qr");
    expect(qrContent.closest("form")).toBe(originalForm);
    expect(screen.getByRole("group", { name: "选择订阅周期" })).toBe(originalCycles);
    expect(within(originalCycles).getByRole<HTMLInputElement>("radio", { name: /季付/ }).matches(":disabled")).toBe(true);
    expect(view.container.querySelector(".checkout-summary")).toBeNull();
    expect(view.container.querySelector(".checkout-confirmed-coupon")?.textContent).toContain("SAVE");
    expect(view.container.querySelector(".checkout-confirmed-coupon")?.textContent).toContain("−¥0.90");
    expect(view.container.querySelector(".purchase-footer-total strong")?.textContent).toBe("¥8.10");
    fireEvent.click(screen.getByRole("button", { name: "检查支付结果" }));
    expect(view.container.querySelectorAll(".payment-method-picker")).toHaveLength(0);
    expect(view.container.querySelector(".checkout-method-confirmed")?.textContent).toContain("Alipay");
    expect(qrContent.closest(".purchase-footer-confirmed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "confirmAndPay{}" })).toBeNull();
    fireEvent.submit(originalForm!);
    expect(mocks.quoteRequest).toHaveBeenCalledTimes(quoteRequests);
    expect(location.hash).toBe("#/plan/1?order=inline-order");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { name: "确认与支付" })).toHaveLength(1);
    expect(mocks.request.mock.calls.filter(([path]) => path === "user/order/save")).toHaveLength(1);
    expect(mocks.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledWith("user/order/checkout", expect.objectContaining({ trade_no: "inline-order", method: 11, expected_payment_amount: 810, expected_payment_currency: "CNY", payment_request_key: expect.any(String) }), { timeoutMs: 45000 });
    view.unmount();
    mocks.request.mockClear(); mocks.quoteRequest.mockClear();
    mocks.detail = { ...mocks.detail, payment_id: 11 };
    const resumed = render(<UnifiedCheckout planId={1} initialOrder="inline-order" />);
    await screen.findByText("正在等待支付确认，请勿重复付款。");
    expect(mocks.request.mock.calls.filter(([path]) => ["user/order/save", "user/order/checkout"].includes(path))).toHaveLength(0);
    expect(mocks.quoteRequest).not.toHaveBeenCalled();
    expect(within(screen.getByRole("group", { name: "选择订阅周期" })).getByRole<HTMLInputElement>("radio", { name: /季付/ }).checked).toBe(true);
    expect(resumed.container.querySelector(".checkout-summary")).toBeNull();
    mocks.detail = { ...mocks.detail, status: 3 };
    resumed.rerender(<UnifiedCheckout planId={1} initialOrder="inline-order" />);
    await screen.findByText("订单已完成");
    expect(resumed.container.querySelector('.purchase-steps [aria-current="step"]')?.textContent).toContain("开通完成");
    expect(screen.queryByDisplayValue("https://pay.example/inline-qr")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(location.hash).toBe("#/plan/1?order=inline-order");
    scroll.mockRestore();
});
it("does not initiate payment when an order read returns a different order", async () => {
    mocks.detail = { ...order, trade_no: "different-owned-order" };
    render(<UnifiedCheckout planId={1} initialOrder="inline-order" />);
    expect(await screen.findByText("订单状态暂不可用，请刷新后重试。")).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.quoteRequest).not.toHaveBeenCalled();
});
it.each(["../order", "https://other.example/order", "bad/order", "a".repeat(65), ""]) ("rejects malformed inline order references: %s", value => {
    expect(checkoutOrderReference(value)).toBeUndefined();
    expect(purchaseReturnPath("#/plan/1?order="+encodeURIComponent(value))).toBe("plan/1");
});
it("keeps only an owned-order lookup reference in the login return path", () => {
    expect(purchaseReturnPath("#/plan/1?order=ORDER_abc-123&requestKey=secret&pay=true&return=https://elsewhere.example")).toBe("plan/1?order=ORDER_abc-123");
    expect(purchaseReturnPath("#/https://elsewhere.example")).toBeUndefined();
});


it("resumes in the original cycle layout with persisted totals and follows authoritative channel quotes", async () => {
    mocks.detail = { ...order, trade_no: "saved-order", currency: "CNY", total_amount: 800, balance_amount: 0, discount_amount: 100 };
    mocks.methods = [
        { id: 11, name: "Alipay", quoted_amount: 800, quoted_currency: "CNY", quoted_fee: 0 },
        { id: 12, name: "Fee channel", quoted_amount: 850, quoted_currency: "CNY", quoted_fee: 50 },
    ];
    mocks.plans = [{ ...plan, quarter_price: 5000 }];
    const view = render(<UnifiedCheckout planId={1} initialOrder="saved-order" />);
    const cycles = await screen.findByRole("group", { name: "选择订阅周期" });
    expect(within(cycles).getByRole<HTMLInputElement>("radio", { name: /季付/ }).checked).toBe(true);
    expect(within(cycles).getByText("¥9.00")).toBeTruthy();
    expect(view.container.querySelector(".purchase-footer-total strong")?.textContent).toBe("¥8.00");
    fireEvent.click(screen.getByRole("radio", { name: "Fee channel" }));
    expect(view.container.querySelector(".purchase-footer-total strong")?.textContent).toBe("¥8.50");
    expect(within(screen.getByRole("region", { name: "priceDetails{}" })).getByText("¥0.50")).toBeTruthy();
    expect(mocks.quoteRequest).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
});
