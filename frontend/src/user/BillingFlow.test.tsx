// @vitest-environment jsdom
vi.mock("../shared/account-copy", () => ({ ac: (key: string) => key }));
import { Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    act,
    within,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    couponsAvailable: true,
    couponPeriods: [] as string[],
    request: vi.fn(),
    navigate: vi.fn(),
    plans: [] as any[],
    orders: [] as any[],
    sub: {} as any,
    methods: [] as any[],
    detail: {} as any,
    detailLoading: false,
    subLoading: false,
    subError: "",
}));
vi.mock("../shared/api", () => ({
    boot: { mode: "user" },
    request: mocks.request,
    navigate: mocks.navigate,
    bytes: (n: number) => `${n} B`,
    money: (value: any) => `¥${(Number(value || 0) / 100).toFixed(2)}`,
    query: (path: string, params: any) =>
        path + "?" + new URLSearchParams(params),
}));
vi.mock("../shared/i18n", () => ({
    default: { addResourceBundle: () => undefined },
    locale: () => "zh-CN",
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
            path === "user/coupon/wallet" ? (mocks.couponsAvailable ? [{id:7,name:"SAVE",discountPercent:10,expiresAt:"2030-01-01T00:00:00Z",status:"available",planIds:[],billingPeriods:mocks.couponPeriods}] : []) : path === "user/coupon/offers" ? [] : path === "user/comm/config"
                ? { coupons_available: mocks.couponsAvailable }
                : path === "user/plan/fetch"
                  ? mocks.plans
                  : path === "user/order/fetch"
                    ? mocks.orders
                    : path === "user/getSubscribe"
                      ? mocks.sub
                      : path.startsWith("user/order/detail")
                        ? mocks.detail
                        : mocks.methods,
        loading: path === "user/getSubscribe" ? mocks.subLoading : path.startsWith("user/order/detail") && mocks.detailLoading,
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
    mocks.couponsAvailable = true;
    mocks.couponPeriods = [];
    mocks.request.mockReset();
    mocks.navigate.mockReset();
    mocks.plans = [plan];
    mocks.orders = [];
    mocks.sub = {};
    mocks.subLoading = false;
    mocks.subError = "";
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
    fireEvent.click(screen.getByLabelText("我的优惠券", { selector: "summary" }));
    fireEvent.click(screen.getByRole("radio", { name: /SAVE/ }));
    expect(screen.getByText("优惠金额")).toBeTruthy();
    expect(screen.getByText("couponEstimate{}")).toBeTruthy();
    expect(screen.getByText("−¥3.00")).toBeTruthy();
    expect(screen.getByText("¥27.00")).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "创建订单并继续" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
            plan_id: 1,
            period: "year_price",
            wallet_coupon_id: 7,
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
    expect(screen.getAllByText("¥10.50")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("radio", { name: /QR/ }));
    expect(screen.getAllByText("¥10.00").length).toBeGreaterThan(0);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "user/order/checkout",
            {
                trade_no: "test-order",
                method: 2,
            },
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
        undefined, expect.objectContaining({signal:expect.any(AbortSignal)}),
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重新发起支付" }));
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
        {
            trade_no: "test-order",
            method: 3,
            token: "test-card-token",
        },
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
            {
                trade_no: "test-order",
                method: 0,
            },
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
        undefined, expect.objectContaining({signal:expect.any(AbortSignal)}),
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
    fireEvent.click(screen.getByRole("button", { name: "创建订单并继续" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
            plan_id: 1,
            period: "quarter_price",
            replace_trade_no: "test-order",
        }),
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
    mocks.plans = [{ ...plan, transfer_enable: null, device_limit: null, speed_limit: 0 }];
    view.rerender(<SubscriptionPurchase />);
    expect(document.querySelector(".pricing-specs")?.children.length).toBe(0);
    expect(screen.queryByText("不限速")).toBeNull();
    expect(screen.queryByText("不限设备数")).toBeNull();
});
it.each(["loading", "error"])("waits for authoritative subscription state before selection (%s)", (state) => {
    mocks.subLoading = state === "loading";
    mocks.subError = state === "error" ? "Subscription temporarily unavailable" : "";
    render(<SubscriptionPurchase />);
    const action = screen.getByRole("button", { name: "subscribe{}" });
    expect(action.matches(":disabled")).toBe(true);
    fireEvent.click(action);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("initially shows an available plan on mobile instead of a sold-out first plan", () => {
    mocks.plans = [{ ...plan, capacity_limit: 0 }, { ...plan, id: 2, name: "Available", capacity_limit: 5 }];
    render(<SubscriptionPurchase />);
    expect(document.querySelector(".mobile-active")?.id).toBe("pricing-plan-2");
    fireEvent.click(within(screen.getByRole("group", { name: "选择套餐" })).getByRole("button", { name: "Basic" }));
    expect(document.querySelector(".mobile-active")?.id).toBe("pricing-plan-1");
    expect(screen.getByRole("button", { name: "暂时售罄" }).matches(":disabled")).toBe(true);
});
it("puts the connection action before receipt details after successful payment", () => {
    checkout({ status: 3 });
    const action = screen.getByRole("link", { name: "快速开始" });
    const receipt = document.querySelector(".receipt-card")!;
    expect(action.getAttribute("href")).toBe("#/subscribe");
    expect(action.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
});

it.each([
    {periods: [], optOut: false, discount: true},
    {periods: ["quarterly"], optOut: false, discount: false},
    {periods: [], optOut: true, discount: false},
])("preserves valid choices across cycle changes without submitting an incompatible coupon: %j", async ({periods, optOut, discount}) => {
    mocks.couponPeriods = periods;
    mocks.request.mockResolvedValue({data:"created-order"});
    render(<SubscriptionPurchase />);
    fireEvent.click(screen.getByRole("button", {name:"subscribe{}"}));
    fireEvent.click(screen.getByLabelText("我的优惠券", {selector:"summary"}));
    fireEvent.click(screen.getByRole("radio", {name:/SAVE/}));
    if (optOut) {
        fireEvent.click(screen.getByLabelText("我的优惠券", {selector:"summary"}));
        fireEvent.click(screen.getByRole("radio", {name:"不使用优惠券"}));
    }
    fireEvent.click(screen.getByRole("radio", {name:/年付/}));
    expect(screen.getByText(discount ? "¥27.00" : "¥30.00", {selector:".purchase-footer-total strong"})).toBeTruthy();
    if (!discount) {
        fireEvent.click(screen.getByRole("radio", {name:/季付/}));
        expect(screen.getByText("¥9.00", {selector:".purchase-footer-total strong"})).toBeTruthy();
        fireEvent.click(screen.getByRole("radio", {name:/年付/}));
    }
    expect(screen.getByText("Basic · 年付")).toBeTruthy();
    expect(screen.getByText(discount ? "couponEstimate{}" : "estimatedSubtotal{}")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"创建订单并继续"}));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
        plan_id:1, period:"year_price", ...(discount ? {wallet_coupon_id:7} : {}),
    }));
});
