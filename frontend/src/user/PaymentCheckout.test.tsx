// @vitest-environment jsdom
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
import { afterEach, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({
    request: vi.fn(),
    trackCopyFailure: vi.fn(),
    methodsError: "",
    reloadMethods: vi.fn(),
    methods: [
        { id: 1, name: "Alipay", handling_fee_fixed: 0 },
        {
            id: 2,
            name: "USDT A",
            category: "crypto",
            asset: "USDT",
            network: "tron",
            network_name: "TRON",
            handling_fee_fixed: 10,
        },
        {
            id: 3,
            name: "USDT B",
            category: "crypto",
            asset: "USDT",
            network: "bsc",
            network_name: "BSC",
            handling_fee_fixed: 100,
            handling_fee_percent: 5,
        },
    ],
}));
vi.mock("../shared/api", () => ({
    request: mock.request,
    bytes: String,
    money: (amount: number, currency = "CNY") =>
        `${currency} ${(Number(amount) / 100).toFixed(2)}`,
    query: (path: string) => path,
}));
vi.mock("../shared/i18n", () => ({
    tx: (value: string) => value,
    locale: () => "zh-CN",
}));
vi.mock("../shared/ui", () => ({
    useData: () => ({ data: mock.methods, loading: false, error: mock.methodsError, reload: mock.reloadMethods }),
    State: ({ children }: any) => children,
    Modal: ({ title, close, children }: any) => (
        <div role="dialog" aria-label={title}>
            <button type="button" onClick={close}>
                关闭
            </button>
            {children}
        </div>
    ),
}));
vi.mock("./pricing-copy", () => ({ pricingCopy: (key: string) => key }));
vi.mock("./product-analytics", () => ({
    useAnalyticsPage: vi.fn(),
    trackCopyFailure: mock.trackCopyFailure,
}));
vi.mock("./PurchaseSteps", () => ({ PurchaseSteps: () => null }));
vi.mock("./OrderHelp", () => ({ OrderHelp: () => null }));
vi.mock("./EmbeddedBrowserNotice", () => ({
    EmbeddedBrowserNotice: () => <p>browser guidance content</p>,
}));
vi.mock("./OrderReceipt", () => ({ OrderReceipt: () => null }));
vi.mock("../shared/credit-copy", () => ({
    c: (value: string) => value,
    minuteDate: () => "",
}));
import { PaymentCheckout, type PaymentQuote } from "./PaymentCheckout";
import { paymentActionUrl, qrPaymentActionUrl } from "./payment-action";
const originalMethods = mock.methods;
function renderCheckout(
    overrides: Record<string, unknown> = {},
    reload = vi.fn(),
) {
    return render(
        <PaymentCheckout
            order={{
                status: 0,
                plan_id: 1,
                total_amount: 1000,
                trade_no: "test-order",
                plan: { name: "Plan" },
                ...overrides,
            }}
            reload={reload}
            renderCard={() => null}
        />,
    );
}

afterEach(() => {
    cleanup();
    mock.methods = originalMethods;
    mock.methodsError = "";
    mock.reloadMethods.mockReset();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
it("opens browser guidance without replacing checkout or initiating payment", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla iPhone MicroMessenger/8");
    try {
        renderCheckout();
        const pay = await screen.findByRole("button", { name: "确认支付" });
        fireEvent.click(screen.getByRole("button", { name: "browserPaymentHelp" }));
        expect(screen.getByRole("dialog", { name: "browserHelpTitle" })).toBeTruthy();
        expect(screen.getByText("browser guidance content")).toBeTruthy();
        expect(screen.getByRole("button", { name: "确认支付" })).toBe(pay);
        expect(mock.request.mock.calls.some(([path]) => path === "user/order/checkout")).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: "关闭" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: "确认支付" })).toBe(pay);
    } finally { ua.mockRestore(); }
});
it("does not show in-app browser guidance to a regular browser", () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Chrome/140.0 Safari/537.36");
    try {
        renderCheckout();
        expect(screen.queryByRole("button", { name: "browserPaymentHelp" })).toBeNull();
    } finally { ua.mockRestore(); }
});
it("recalculates the exact network fee and submits its channel ID", async () => {
    mock.request.mockResolvedValue({
        type: 0,
        data: "https://example.test/qr",
    });
    renderCheckout();
    await waitFor(() =>
        expect(
            (screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement)
                .checked,
        ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /USDT/ }));
    expect(
        (screen.getByRole("button", { name: "确认支付" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /BSC/ }));
    expect(screen.getByText("CNY 11.50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() =>
        expect(mock.request).toHaveBeenCalledWith(
            "user/order/checkout",
            expect.objectContaining({
                trade_no: "test-order",
                method: 3,
                payment_request_key: expect.any(String),
            }),
            { timeoutMs: 45000 },
        ),
    );
    await screen.findByDisplayValue("https://example.test/qr");
    expect(screen.queryByText("正在等待支付确认，请勿重复付款。")).toBeNull();
    expect(
        screen.getByRole("radio", { name: /BSC/ }).closest("fieldset")
            ?.disabled,
    ).toBe(true);
});

it.each([
    { code: "NETWORK_ERROR" },
    { code: "REQUEST_TIMEOUT" },
    { code: "RESPONSE_INVALID" },
    { code: "SERVICE_UNAVAILABLE", status: 503 },
    { code: "EMPTY_PAYMENT_ACTION", invalidAction: true },
])(
    "checks status without resubmitting after $code",
    async ({ code, status, invalidAction }) => {
        mock.request.mockImplementation(async (path: string) => {
            if (path !== "user/order/checkout") {
                return { data: path === "user/order/detail" ? { status: 0, payment_id: 1 } : 0 };
            }
            if (invalidAction) return { type: 0, data: "" };
            throw Object.assign(new Error("Load failed"), { code, status });
        });
        const reload = vi.fn();
        renderCheckout({ trade_no: "uncertain" }, reload);
        fireEvent.click(
            await screen.findByRole("button", { name: "确认支付" }),
        );
        await screen.findByText(
            "未能确认支付请求结果，正在检查订单状态，请勿重复付款。",
        );
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByText("正在等待支付确认，请勿重复付款。")).toBeNull();
        expect(screen.queryByRole("button", { name: "继续支付" })).toBeNull();
        await waitFor(() =>
            expect(mock.request).toHaveBeenCalledWith(
                "user/order/check",
                undefined,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            ),
        );
        expect(screen.queryByText("Load failed")).toBeNull();
        expect(
            screen.getByRole("radio", { name: "Alipay" }).closest("fieldset")
                ?.disabled,
        ).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
        await waitFor(() => expect(reload).toHaveBeenCalled());
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "reselectPayment" }));
        fireEvent.click(screen.getByRole("button", { name: "继续" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        fireEvent.click(await screen.findByRole("radio", { name: "Alipay" }));
        await screen.findByRole("button", { name: "retryPaymentRequest" });
        expect(
            screen.queryByText(
                "未能确认支付请求结果，正在检查订单状态，请勿重复付款。",
            ),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    },
);

it("recovers an unconfirmed checkout on the only available channel using the original request", async () => {
    const quotedMethod = {
        ...originalMethods[0], quoted_amount: 1000, quoted_currency: "CNY",
    };
    mock.methods = [quotedMethod];
    const submit = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("Load failed"), { code: "REQUEST_TIMEOUT" }))
        .mockResolvedValueOnce({ type: 0, data: "recovered-qr-payload" });
    mock.request.mockImplementation((path: string, body) =>
        path === "user/order/checkout" ? submit(body) : Promise.resolve({ data: 0 }),
    );
    renderCheckout();
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    const retryPayment = await screen.findByRole("button", { name: "retryPaymentRequest" });
    expect(submit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    await waitFor(() => expect((retryPayment as HTMLButtonElement).disabled).toBe(false));
    expect(submit).toHaveBeenCalledTimes(1);
    const repricedMethod = { ...quotedMethod, quoted_amount: 1200 };
    mock.methods = [repricedMethod];
    fireEvent.click(retryPayment);

    await screen.findByDisplayValue("recovered-qr-payload");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
    expect(submit.mock.calls[1][0]).toMatchObject({
        payment_request_key: expect.any(String), expected_payment_amount: 1000,
    });
});

it("returns to quote confirmation when a replay conflicts and the order has no linked payment", async () => {
    mock.methods = [originalMethods[0]];
    const submit = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("Load failed"), { code: "REQUEST_TIMEOUT" }))
        .mockRejectedValueOnce(Object.assign(new Error("Quote changed"), { status: 409 }));
    mock.request.mockImplementation(async (path: string, body) => {
        if (path === "user/order/checkout") return submit(body);
        if (path === "user/order/detail") return { data: { status: 0, payment_id: null } };
        return { data: 0 };
    });
    renderCheckout();
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    fireEvent.click(await screen.findByRole("button", { name: "retryPaymentRequest" }));
    expect((await screen.findByRole("button", { name: "确认支付" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Quote changed")).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(2);
});

it("sends the old channel only when the user confirms restarting and selects a different channel", async () => {
    mock.methods = [originalMethods[0], { id: 11, name: "WeChat Pay", handling_fee_fixed: 0 } as any];
    mock.request.mockImplementation(async (path: string) => {
        if (path === "user/order/checkout") return { type: 0, data: "new-channel-qr" };
        if (path === "user/order/detail") return { data: { status: 0, payment_id: 1 } };
        return { data: 0 };
    });
    renderCheckout({ trade_no: "switch-order", payment_id: 3 });

    const reselect = await screen.findByRole("button", { name: "reselectPayment" });
    expect(reselect.closest(".checkout-secondary-actions")).toBeTruthy();
    fireEvent.click(reselect);
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    const confirm = await screen.findByRole<HTMLButtonElement>("button", { name: "确认支付" });
    expect(confirm.disabled).toBe(true);
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(0);
    expect((screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: "WeChat Pay" }));
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(
        "user/order/checkout",
        expect.objectContaining({ method: 11, switch_from_payment_method: 1, payment_request_key: expect.any(String) }),
        { timeoutMs: 45000 },
    ));
});

it.each([
    { code: "PAYMENT_CHANNEL_UNAVAILABLE", status: 422, message: "paymentChannelUnavailable", awaiting: false },
    { code: "PAYMENT_GATEWAY_REJECTED", status: 500, message: "paymentGatewayRejected", awaiting: true },
    { code: "PAYMENT_CONFIRMATION_PENDING", status: 409, message: "paymentConfirmationPending", awaiting: true },
])("shows the right next step after a switch returns $code", async ({ code, status, message, awaiting }) => {
    mock.methods = [originalMethods[0], { id: 11, name: "WeChat Pay", handling_fee_fixed: 0 } as any];
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error("Gateway internals"), { code, status }));
    mock.request.mockImplementation(async (path: string, body) => {
        if (path === "user/order/checkout") return submit(body);
        if (path === "user/order/detail") return { data: { status: 0, payment_id: 1 } };
        return { data: 0 };
    });
    const reload = vi.fn();
    const order = { status: 0, plan_id: 1, total_amount: 1000, trade_no: "switch-error-order", plan: { name: "Plan" } };
    const checkout = (paymentId: number) => (
        <PaymentCheckout order={{ ...order, payment_id: paymentId }} reload={reload} renderCard={() => null} />
    );
    const view = render(checkout(3));
    fireEvent.click(await screen.findByRole("button", { name: "reselectPayment" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("radio", { name: "WeChat Pay" }));
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));

    const feedback = await screen.findByText(message);
    expect(feedback.getAttribute("role")).toBe(awaiting ? "status" : "alert");
    expect(screen.queryByText("Gateway internals")).toBeNull();
    expect(screen.queryByText("未能确认支付请求结果，正在检查订单状态，请勿重复付款。")).toBeNull();
    expect(screen.queryByRole("button", { name: "retryPaymentRequest" })).toBeNull();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ method: 11, switch_from_payment_method: 1 }));
    if (awaiting) {
        if (code === "PAYMENT_GATEWAY_REJECTED") {
            view.rerender(checkout(11));
            expect(screen.getByText("paymentGatewayRejected")).toBeTruthy();
        }
        if (code === "PAYMENT_CONFIRMATION_PENDING") {
            expect((screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement).checked).toBe(true);
        }
        fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
        expect(reload).toHaveBeenCalled();
    } else {
        expect((screen.getByRole("button", { name: "确认支付" }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByRole("radio", { name: "WeChat Pay" })).toBeNull();
        expect(mock.reloadMethods).toHaveBeenCalled();
    }
    expect(submit).toHaveBeenCalledTimes(1);
});

it.each([false, true])("refreshes and requires another channel after a preflight rejection (method refresh fails: %s)", async (refreshFails) => {
    mock.methods = [originalMethods[0], { id: 11, name: "WeChat Pay", handling_fee_fixed: 0 } as any];
    mock.reloadMethods.mockImplementation(() => {
        if (refreshFails) mock.methodsError = "Payment methods temporarily unavailable";
    });
    mock.request.mockImplementation(async (path: string, body) => {
        if (path !== "user/order/checkout") return { data: 0 };
        if (body.method === 1) throw Object.assign(new Error("Gateway config error"), { code: "PAYMENT_CHANNEL_UNAVAILABLE", status: 422 });
        return { type: 0, data: "other-channel-qr" };
    });
    const reload = vi.fn();
    const view = renderCheckout({}, reload);
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    await screen.findByText("paymentChannelUnavailable");
    expect(screen.queryByRole("radio", { name: "Alipay" })).toBeNull();
    expect(mock.reloadMethods).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "确认支付" }).disabled).toBe(true);
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "WeChat Pay" }));
    if (refreshFails) {
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "确认支付" }).disabled).toBe(true);
        mock.methodsError = "";
        view.rerender(<PaymentCheckout order={{ status: 0, plan_id: 1, total_amount: 1000, trade_no: "test-order", plan: { name: "Plan" } }} reload={reload} renderCard={() => null} />);
    }
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByDisplayValue("other-channel-qr");
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(2);
    expect(mock.request.mock.calls.find(([path, body]) => path === "user/order/checkout" && body.method === 11)?.[1]).toMatchObject({ trade_no: "test-order", method: 11 });
});

it("does not keep offering the only rejected channel even when refreshed methods still include it", async () => {
    mock.methods = [originalMethods[0]];
    mock.request.mockRejectedValue(Object.assign(new Error("Unavailable"), { code: "PAYMENT_CHANNEL_UNAVAILABLE", status: 422 }));
    renderCheckout();
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    await screen.findByText("暂无可用支付方式，请联系客服。");
    expect(screen.queryByRole("radio", { name: "Alipay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "checkPayment" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "确认支付" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(mock.reloadMethods).toHaveBeenCalledTimes(2);
    expect(mock.request).toHaveBeenCalledTimes(1);
});

it("restores a repaired sole channel only after an explicit successful refresh and fresh confirmation", async () => {
    mock.methods = [originalMethods[0]];
    let repaired = false;
    mock.request.mockImplementation(async (path: string) => {
        if (path !== "user/order/checkout") return { data: 0 };
        if (!repaired) throw Object.assign(new Error("Unavailable"), { code: "PAYMENT_CHANNEL_UNAVAILABLE", status: 422 });
        return { type: 0, data: "repaired-channel-qr" };
    });
    const order = { status: 0, plan_id: 1, total_amount: 1000, trade_no: "repaired-order" };
    const checkout = () => <PaymentCheckout order={order} reload={() => {}} renderCard={() => null} />;
    const view = render(checkout());
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    await screen.findByText("暂无可用支付方式，请联系客服。");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    mock.methodsError = "Refresh failed";
    view.rerender(checkout());
    expect(screen.queryByRole("radio", { name: "Alipay" })).toBeNull();
    mock.methodsError = "";
    mock.methods = [originalMethods[0]];
    view.rerender(checkout());
    expect(screen.queryByRole("radio", { name: "Alipay" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    mock.methods = [originalMethods[0]];
    view.rerender(checkout());
    const channel = await screen.findByRole<HTMLInputElement>("radio", { name: "Alipay" });
    expect(channel.checked).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "确认支付" }).disabled).toBe(true);
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
    repaired = true;
    fireEvent.click(channel);
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByDisplayValue("repaired-channel-qr");
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(2);
});

it("does not carry a channel rejection into a different order", async () => {
    mock.methods = [originalMethods[0]];
    mock.request.mockRejectedValue(Object.assign(new Error("Unavailable"), { code: "PAYMENT_CHANNEL_UNAVAILABLE", status: 422 }));
    const checkout = (tradeNo: string) => <PaymentCheckout order={{ status: 0, plan_id: 1, total_amount: 1000, trade_no: tradeNo }} reload={() => {}} renderCard={() => null} />;
    const view = render(checkout("first-order"));
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    await screen.findByText("暂无可用支付方式，请联系客服。");
    view.rerender(checkout("second-order"));
    expect(await screen.findByRole("radio", { name: "Alipay" })).toBeTruthy();
    expect(mock.request).toHaveBeenCalledTimes(1);
});

it("keeps the original payment recoverable after another channel fails before initiation", async () => {
    mock.methods = [originalMethods[0], { id: 11, name: "WeChat Pay", handling_fee_fixed: 0 } as any];
    mock.request.mockImplementation(async (path: string, body) => {
        if (path === "user/order/detail") return { data: { status: 0, payment_id: 1 } };
        if (path !== "user/order/checkout") return { data: 0 };
        if (body.resume_payment) return { type: 0, data: "original-valid-qr" };
        throw Object.assign(new Error("Unavailable"), { code: "PAYMENT_CHANNEL_UNAVAILABLE", status: 422 });
    });
    renderCheckout({ payment_id: 1 });
    await screen.findByDisplayValue("original-valid-qr");
    fireEvent.click(screen.getByRole("button", { name: "reselectPayment" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "WeChat Pay" }));
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await screen.findByText("paymentChannelUnavailable");
    fireEvent.click(screen.getByRole("radio", { name: "Alipay" }));
    fireEvent.click(screen.getByRole("button", { name: "paymentOpenAgain" }));
    await screen.findByDisplayValue("original-valid-qr");
    expect(mock.request.mock.calls.filter(([path, body]) => path === "user/order/checkout" && !body.resume_payment)).toEqual([
        ["user/order/checkout", expect.objectContaining({ method: 11, switch_from_payment_method: 1 }), { timeoutMs: 45000 }],
    ]);
});

it("keeps the restored QR visible without a dismiss control or another checkout", async () => {
    mock.request.mockImplementation(async (path: string) =>
        path === "user/order/checkout"
            ? { type: 0, data: "saved-qr-payload" }
            : { data: 0 },
    );
    renderCheckout({ payment_id: 1 });
    await screen.findByDisplayValue("saved-qr-payload");
    expect(mock.request).toHaveBeenCalledWith(
        "user/order/checkout",
        { trade_no: "test-order", method: 1, resume_payment: true },
        { timeoutMs: 8000 },
    );
    expect(screen.queryByRole("button", { name: "关闭二维码" })).toBeNull();
    expect(screen.queryByRole("button", { name: "继续支付" })).toBeNull();
    const checkResult = screen.getByRole("button", { name: "checkPayment" });
    expect(checkResult.classList.contains("primary")).toBe(true);
    expect(checkResult.parentElement?.className).toBe("checkout-confirm");
    fireEvent.click(checkResult);
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});

it.each([0, 1])("reports a completed manual check without starting another type %s payment", async (type) => {
    mock.request.mockImplementation(async (path: string) => path === "user/order/checkout"
        ? { type, data: "https://gateway.example.test/pay" } : { data: 0 });
    renderCheckout({ payment_id: 1 });
    await screen.findByRole(type === 0 ? "img" : "link", { name: type === 0 ? "付款内容" : "openPayment" });
    expect(screen.queryByText("paymentNotConfirmed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    expect((await screen.findByText("paymentNotConfirmed")).getAttribute("role")).toBe("status");
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});

it.each([
    { type: 0, nextStatus: 1 }, { type: 1, nextStatus: 1 },
    { type: 0, nextStatus: 2 }, { type: 0, nextStatus: 3 }, { type: 1, nextStatus: 4 },
])("removes type $type payment actions as soon as status $nextStatus is observed, even if detail stays stale", async ({ type, nextStatus }) => {
    let checkedStatus = 0;
    mock.request.mockImplementation(async (path: string) => path === "user/order/checkout"
        ? { type, data: "https://gateway.example.test/old-payment" } : { data: checkedStatus });
    const reload = vi.fn();
    const order = { status: 0, plan_id: 1, total_amount: 1000, trade_no: "transition-order", payment_id: 1 };
    const checkout = (status: number) => <PaymentCheckout order={{ ...order, status }} reload={reload} renderCard={() => null} />;
    const view = render(checkout(0));
    await screen.findByRole(type === 0 ? "img" : "link", { name: type === 0 ? "付款内容" : "openPayment" });
    checkedStatus = nextStatus;
    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    await screen.findByText("paymentStatusUpdating");
    view.rerender(checkout(0));
    expect(screen.queryByRole("img", { name: "付款内容" })).toBeNull();
    expect(screen.queryByRole("link", { name: "openPayment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "reselectPayment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消订单" })).toBeNull();
    const calls = reload.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(reload).toHaveBeenCalledTimes(calls + 1);
    view.rerender(checkout(nextStatus));
    expect(screen.queryByText("paymentStatusUpdating")).toBeNull();
    if (nextStatus === 1) expect(screen.getByText("支付已确认，正在开通")).toBeTruthy();
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});

it("ignores a saved QR that arrives in the same turn after the status check confirms payment", async () => {
    let resolveStatus!: (value: { data: number }) => void;
    let resolveEntry!: (value: { type: number; data: string }) => void;
    const status = new Promise((resolve) => { resolveStatus = resolve; });
    const entry = new Promise((resolve) => { resolveEntry = resolve; });
    mock.request.mockImplementation((path: string) => path === "user/order/checkout" ? entry : status);
    renderCheckout({ payment_id: 1 });
    await act(async () => {
        resolveStatus({ data: 3 });
        resolveEntry({ type: 0, data: "already-paid-qr" });
    });
    expect(screen.getByText("paymentStatusUpdating")).toBeTruthy();
    expect(screen.queryByDisplayValue("already-paid-qr")).toBeNull();
    expect(screen.queryByRole("button", { name: "reselectPayment" })).toBeNull();
});

it("recovers a compact order's channel load failure through the existing check action", async () => {
    mock.methods = [];
    mock.methodsError = "Payment methods temporarily unavailable";
    mock.reloadMethods.mockImplementation(() => {
        mock.methods = originalMethods;
        mock.methodsError = "";
    });
    mock.request.mockImplementation(async (path: string) => path === "user/order/checkout"
        ? { type: 0, data: "recovered-after-method-load" } : { data: 0 });
    render(<PaymentCheckout compact order={{ status: 0, plan_id: 1, total_amount: 1000, trade_no: "method-load-error", payment_id: 1 }} reload={() => {}} renderCard={() => null} />);
    await screen.findByText("Payment methods temporarily unavailable");
    expect(screen.queryByRole("img", { name: "付款内容" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    await screen.findByDisplayValue("recovered-after-method-load");
    expect(screen.queryByText("Payment methods temporarily unavailable")).toBeNull();
    expect(mock.reloadMethods).toHaveBeenCalledTimes(1);
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toEqual([
        ["user/order/checkout", { trade_no: "method-load-error", method: 1, resume_payment: true }, { timeoutMs: 8000 }],
    ]);
});

it("keeps the current payment available when reselection receives an invalid order status", async () => {
    mock.request.mockImplementation(async (path: string) => {
        if (path === "user/order/checkout") return { type: 0, data: "current-valid-qr" };
        if (path === "user/order/detail") return { data: {} };
        return { data: 0 };
    });
    renderCheckout({ payment_id: 1 });
    await screen.findByDisplayValue("current-valid-qr");
    fireEvent.click(screen.getByRole("button", { name: "reselectPayment" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await screen.findByText("订单状态暂不可用，请刷新后重试。");
    expect(screen.queryByText("paymentStatusUpdating")).toBeNull();
    expect(screen.getByDisplayValue("current-valid-qr")).toBeTruthy();
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});

it("confirms successful copying on desktop without starting another payment", async () => {
    vi.stubGlobal("innerWidth", 1280);
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    mock.request.mockImplementation(async (path: string) => path === "user/order/checkout"
        ? { type: 0, data: "copy-this-payment" } : { data: 0 });
    renderCheckout({ payment_id: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "复制" }));
    await screen.findByRole("button", { name: "paymentCopied" });
    expect(copy).toHaveBeenCalledWith("copy-this-payment");
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});

it("discards a late payment response when the order already uses a different channel", async () => {
    let returnOldPayment!: (value: { type: number; data: string }) => void;
    const oldPayment = new Promise((resolve) => { returnOldPayment = resolve; });
    mock.request.mockImplementation(async (path: string, body) => {
        if (path !== "user/order/checkout") return { data: 0 };
        if (body.resume_payment) return { type: 0, data: "current-channel-qr" };
        return oldPayment;
    });
    const order = { status: 0, plan_id: 1, total_amount: 1000, trade_no: "changing-channel-order", plan: { name: "Plan" } };
    const checkout = (paymentId?: number) => (
        <PaymentCheckout order={{ ...order, payment_id: paymentId }} reload={() => {}} renderCard={() => null} />
    );
    const view = render(checkout());
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    view.rerender(checkout(2));
    await act(async () => { returnOldPayment({ type: 0, data: "old-channel-qr" }); });

    await screen.findByDisplayValue("current-channel-qr");
    expect(screen.queryByDisplayValue("old-channel-qr")).toBeNull();
    expect(mock.request).toHaveBeenCalledWith("user/order/checkout",
        { trade_no: "changing-channel-order", method: 2, resume_payment: true }, { timeoutMs: 8000 });
});

it("explains that the old payment is shown after a blocked switch", async () => {
    mock.methods = [originalMethods[0], { id: 11, name: "WeChat Pay", handling_fee_fixed: 0 } as any];
    mock.request.mockImplementation(async (path: string, body) => {
        if (path === "user/order/detail") return { data: { status: 0, payment_id: 1 } };
        if (path !== "user/order/checkout") return { data: 0 };
        if (body.resume_payment) return { type: 0, data: "original-alipay-qr" };
        throw Object.assign(new Error("In flight"), { code: "PAYMENT_CONFIRMATION_PENDING" });
    });
    renderCheckout({ payment_id: 1 });
    await screen.findByDisplayValue("original-alipay-qr");
    fireEvent.click(screen.getByRole("button", { name: "reselectPayment" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("radio", { name: "WeChat Pay" }));
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));

    await screen.findByText("paymentSwitchUnchanged");
    expect(screen.getByDisplayValue("original-alipay-qr")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement).checked).toBe(true);
    expect(mock.request.mock.calls.filter(([path, body]) => path === "user/order/checkout" && !body.resume_payment)).toHaveLength(1);
});

it("stops automatic entry recovery after repeated pending responses and keeps manual recovery available", async () => {
    vi.useFakeTimers();
    try {
        const resume = vi.fn().mockRejectedValue(Object.assign(new Error("In flight"), { code: "PAYMENT_CONFIRMATION_PENDING" }));
        mock.request.mockImplementation(async (path: string, body) =>
            path === "user/order/checkout" ? resume(body) : { data: 0 },
        );
        await act(async () => { renderCheckout({ payment_id: 1 }); });
        for (let attempt = 0; attempt < 6; attempt++) {
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        }
        expect(screen.getByText("paymentActionUnavailable")).toBeTruthy();
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "checkPayment" }).disabled).toBe(false);
        expect(screen.queryByRole("button", { name: "paymentOpenAgain" })).toBeNull();
        expect(resume).toHaveBeenCalledTimes(5);
        expect(resume.mock.calls.every(([body]) => body.resume_payment === true)).toBe(true);
    } finally { vi.useRealTimers(); }
});

it.each([
    { phase: "initial", nextStatus: 0 },
    { phase: "pending", nextStatus: 0 },
    { phase: "exhausted", nextStatus: 0 },
    { phase: "unavailable", nextStatus: 0 },
    { phase: "exhausted", nextStatus: 3 },
])("checks status before restoring a late entry on return from a hidden $phase page (status $nextStatus)", async ({ phase, nextStatus }) => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue(phase === "initial" ? "hidden" : "visible");
    try {
        let saved = false;
        let checkedStatus = 0;
        const resume = vi.fn(async (_body?: unknown) => {
            if (saved) return { type: 0, data: "late-saved-entry" };
            throw Object.assign(new Error("Entry not ready"), {
                code: phase === "unavailable" ? "PAYMENT_ACTION_UNAVAILABLE" : "PAYMENT_CONFIRMATION_PENDING",
            });
        });
        mock.request.mockImplementation(async (path: string, body) => path === "user/order/checkout" ? resume(body) : { data: checkedStatus });
        await act(async () => { renderCheckout({ payment_id: 1 }); });
        if (phase === "exhausted") {
            for (let attempt = 0; attempt < 6; attempt++) {
                await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            }
            expect(resume).toHaveBeenCalledTimes(5);
        }
        const restoresBefore = resume.mock.calls.length;
        visibility.mockReturnValue("hidden");
        await act(async () => {
            fireEvent(document, new Event("visibilitychange"));
            await vi.advanceTimersByTimeAsync(60000);
        });
        expect(resume).toHaveBeenCalledTimes(restoresBefore);
        const checksBefore = mock.request.mock.calls.filter(([path]) => path === "user/order/check").length;
        saved = true;
        checkedStatus = nextStatus;
        visibility.mockReturnValue("visible");
        await act(async () => {
            fireEvent(document, new Event("visibilitychange"));
            fireEvent(window, new Event("focus"));
        });
        expect(mock.request.mock.calls.filter(([path]) => path === "user/order/check")).toHaveLength(checksBefore + 1);
        if (nextStatus === 0) expect(screen.getByDisplayValue("late-saved-entry")).toBeTruthy();
        else {
            expect(screen.getByText("paymentStatusUpdating")).toBeTruthy();
            expect(screen.queryByDisplayValue("late-saved-entry")).toBeNull();
        }
        expect(resume).toHaveBeenCalledTimes(restoresBefore + (nextStatus === 0 ? 1 : 0));
        expect(mock.request.mock.calls.filter(([path, body]) => path === "user/order/checkout" && !body.resume_payment)).toHaveLength(0);
    } finally { visibility.mockRestore(); vi.useRealTimers(); }
});

it("recovers a QR automatically when a pending gateway saves it without changing the order status", async () => {
    vi.useFakeTimers();
    try {
        const resume = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error("In flight"), { code: "PAYMENT_CONFIRMATION_PENDING" }))
            .mockResolvedValueOnce({ type: 0, data: "late-wechat-qr" });
        mock.request.mockImplementation(async (path: string, body) =>
            path === "user/order/checkout" ? resume(body) : { data: 0 },
        );
        const reload = vi.fn();
        await act(async () => { renderCheckout({ payment_id: 1 }, reload); });
        expect(screen.getByText("paymentConfirmationPending")).toBeTruthy();
        expect(screen.getByRole("button", { name: "checkPayment" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "paymentOpenAgain" })).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

        expect(screen.getByDisplayValue("late-wechat-qr")).toBeTruthy();
        expect(screen.queryByText("paymentConfirmationPending")).toBeNull();
        expect(screen.queryByRole("button", { name: "paymentOpenAgain" })).toBeNull();
        expect(resume.mock.calls).toEqual([
            [{ trade_no: "test-order", method: 1, resume_payment: true }],
            [{ trade_no: "test-order", method: 1, resume_payment: true }],
        ]);
        expect(reload).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
});

it.each([0, 3])("checks order status before recovering the original payment when the order returns %s", async (status) => {
    vi.useFakeTimers();
    try {
        const resume = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error("In flight"), { code: "PAYMENT_CONFIRMATION_PENDING" }))
            .mockRejectedValueOnce(Object.assign(new Error("No saved entry"), { code: "PAYMENT_ACTION_UNAVAILABLE" }));
        let check = Promise.resolve({ data: 0 });
        mock.request.mockImplementation(async (path: string, body) =>
            path === "user/order/checkout" ? resume(body) : check,
        );
        await act(async () => { renderCheckout({ payment_id: 1 }); });
        let finishCheck!: (result: { data: number }) => void;
        check = new Promise((resolve) => { finishCheck = resolve; });
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "checkPayment" })); });
        expect(resume).toHaveBeenCalledTimes(1);
        await act(async () => { finishCheck({ data: status }); });
        if (status === 0) {
            expect(screen.getByText("paymentActionUnavailable")).toBeTruthy();
            expect(screen.queryByText("paymentConfirmationPending")).toBeNull();
            expect(screen.getByRole("button", { name: "reselectPayment" })).toBeTruthy();
        }
        await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
        expect(resume.mock.calls).toEqual(Array(status === 0 ? 2 : 1).fill([
            { trade_no: "test-order", method: 1, resume_payment: true },
        ]));
    } finally { vi.useRealTimers(); }
});

it("restores the saved cashier without navigating away or creating a payment", async () => {
    const cashier = "https://gateway.example.test/cashier/owned-order";
    mock.request.mockImplementation(async (path: string, body) =>
        path === "user/order/checkout" && body?.resume_payment
            ? { type: 1, data: cashier }
            : { data: 0 },
    );
    renderCheckout({ payment_id: 1 });
    expect((await screen.findByRole("link", { name: "openPayment" })).getAttribute("href")).toBe(cashier);
    expect(screen.queryByRole("button", { name: "继续支付" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toEqual([
        ["user/order/checkout", { trade_no: "test-order", method: 1, resume_payment: true }, { timeoutMs: 8000 }],
    ]);
});

it("shows the converted payment amount and confirms it without relabelling the USD order", async () => {
    const old = mock.methods;
    mock.methods = [
        {
            id: 1,
            name: "CNY Alipay",
            handling_fee_fixed: 0,
            quoted_amount: 3625,
            quoted_currency: "CNY",
            quoted_fee: 0,
        } as any,
    ];
    try {
        mock.request.mockResolvedValue({ type: 0, data: "payment-code" });
        renderCheckout({
            total_amount: 500,
            currency: "USD",
            trade_no: "usd-order",
        });
        expect(await screen.findByText(/实际付款.*CNY 36.25/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
        await waitFor(() =>
            expect(mock.request).toHaveBeenCalledWith(
                "user/order/checkout",
                expect.objectContaining({
                    expected_payment_amount: 3625,
                    expected_payment_currency: "CNY",
                }),
                { timeoutMs: 45000 },
            ),
        );
    } finally {
        mock.methods = old;
    }
});

it("locks an externally issued payment after an order refresh and does not unlock on an older snapshot", async () => {
    mock.request.mockImplementation(async (path: string) => {
        if (path === "user/order/checkout") throw Object.assign(new Error("No saved payment"), { status: 409 });
        return { data: 0 };
    });
    const onQuoteChange = vi.fn();
    const reload = vi.fn();
    const original = {
        status: 0,
        plan_id: 1,
        currency: "CNY",
        total_amount: 1000,
        trade_no: "another-tab-order",
        plan: { name: "Plan" },
    };
    const checkout = (order: Record<string, unknown>) => (
        <PaymentCheckout
            order={order}
            reload={reload}
            renderCard={() => null}
            onQuoteChange={onQuoteChange}
        />
    );
    const view = render(checkout(original));
    await waitFor(() =>
        expect(
            (screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement)
                .checked,
        ).toBe(true),
    );
    expect(screen.getByRole("button", { name: "确认支付" })).toBeTruthy();
    view.rerender(
        checkout({
            ...original,
            payment_id: 2,
            handling_amount: 10,
            payment_amount: 1010,
            payment_currency: "CNY",
        }),
    );
    await screen.findByText("paymentActionUnavailable");
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    expect(
        screen.getByRole("radio", { name: "Alipay" }).closest("fieldset")
            ?.disabled,
    ).toBe(true);
    expect(
        (screen.getByRole("radio", { name: /TRON/ }) as HTMLInputElement)
            .checked,
    ).toBe(true);
    await waitFor(() =>
        expect(onQuoteChange).toHaveBeenLastCalledWith({
            amount: 1010,
            currency: "CNY",
            fee: 10,
        }),
    );
    view.rerender(checkout(original));
    expect(screen.getByText("paymentActionUnavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    expect(
        (screen.getByRole("radio", { name: /TRON/ }) as HTMLInputElement)
            .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(
        mock.request.mock.calls.filter(
            ([path, body]) => path === "user/order/checkout" && !body?.resume_payment,
        ),
    ).toHaveLength(0);
});

it.each(["NETWORK_ERROR", "REQUEST_TIMEOUT"])(
    "keeps the confirmed FX payment quote while its result is unknown after %s",
    async (code) => {
        const old = mock.methods;
        mock.methods = [
            {
                id: 1,
                name: "CNY Alipay",
                handling_fee_fixed: 0,
                quoted_amount: 3625,
                quoted_currency: "CNY",
                quoted_fee: 0,
            } as any,
        ];
        try {
            mock.request.mockImplementation((path: string) =>
                path === "user/order/checkout"
                    ? Promise.reject(
                          Object.assign(new Error("Load failed"), { code }),
                      )
                    : Promise.resolve({ data: 0 }),
            );
            const onQuoteChange = vi.fn();
            render(
                <PaymentCheckout
                    order={{
                        status: 0,
                        plan_id: 1,
                        total_amount: 500,
                        currency: "USD",
                        trade_no: "unknown-fx-order",
                        plan: { name: "Plan" },
                    }}
                    reload={vi.fn()}
                    renderCard={() => null}
                    onQuoteChange={onQuoteChange}
                />,
            );
            await screen.findByText(/实际付款.*CNY 36.25/);
            fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
            await screen.findByText(
                "未能确认支付请求结果，正在检查订单状态，请勿重复付款。",
            );
            expect(screen.getByText(/实际付款.*CNY 36.25/)).toBeTruthy();
            expect(onQuoteChange).toHaveBeenLastCalledWith({
                amount: 3625,
                currency: "CNY",
                fee: 0,
            });
            expect(
                (
                    screen.getByRole("button", {
                        name: "checkPayment",
                    }) as HTMLButtonElement
                ).disabled,
            ).toBe(false);
            expect(
                screen.queryByRole("button", { name: "确认支付" }),
            ).toBeNull();
            expect(
                mock.request.mock.calls.filter(
                    ([path]) => path === "user/order/checkout",
                ),
            ).toHaveLength(1);
        } finally {
            mock.methods = old;
        }
    },
);

it("clears the reported channel quote until a concrete crypto network is chosen", async () => {
    const onQuoteChange = vi.fn<(quote: PaymentQuote | undefined) => void>();
    render(
        <PaymentCheckout
            order={{
                status: 0,
                plan_id: 1,
                total_amount: 1000,
                currency: "CNY",
                trade_no: "network-selection-order",
                plan: { name: "Plan" },
            }}
            reload={vi.fn()}
            renderCard={() => null}
            onQuoteChange={onQuoteChange}
        />,
    );
    await waitFor(() =>
        expect(onQuoteChange).toHaveBeenLastCalledWith({
            amount: 1000,
            currency: "CNY",
            fee: 0,
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: /USDT/ }));
    expect(
        (screen.getByRole("button", { name: "确认支付" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    expect(onQuoteChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole("radio", { name: /BSC/ }));
    expect(onQuoteChange).toHaveBeenLastCalledWith({
        amount: 1150,
        currency: "CNY",
        fee: 150,
    });
    expect(
        (screen.getByRole("button", { name: "确认支付" }) as HTMLButtonElement)
            .disabled,
    ).toBe(false);
    expect(
        mock.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(0);
});

it.each([
    { label: "amount", amount: 1100, currency: "CNY" },
    { label: "currency", amount: 1000, currency: "USD" },
])(
    "preserves a matching issued QR but clears it when its channel's authoritative $label changes",
    async ({ amount, currency }) => {
        const old = mock.methods;
        mock.methods = [
            {
                id: 1,
                name: "Alipay",
                handling_fee_fixed: 0,
                quoted_amount: 1000,
                quoted_currency: "CNY",
                quoted_fee: 0,
            } as any,
        ];
        try {
            mock.request.mockImplementation(async (path: string, body) =>
                path === "user/order/checkout"
                    ? { type: 0, data: body?.resume_payment ? "new-authoritative-qr" : "https://example.test/snapshot-qr" }
                    : { data: 0 },
            );
            const onQuoteChange = vi.fn();
            const reload = vi.fn();
            const original = {
                status: 0,
                plan_id: 1,
                total_amount: 1000,
                currency: "CNY",
                trade_no: "qr-snapshot-order",
                plan: { name: "Plan" },
            };
            const checkout = (order: Record<string, unknown>) => (
                <PaymentCheckout
                    order={order}
                    reload={reload}
                    renderCard={() => null}
                    onQuoteChange={onQuoteChange}
                />
            );
            const view = render(checkout(original));
            fireEvent.click(
                await screen.findByRole("button", { name: "确认支付" }),
            );
            const qrContent = await screen.findByRole<HTMLInputElement>(
                "textbox",
                { name: "付款内容" },
            );
            expect(qrContent.value).toBe("https://example.test/snapshot-qr");
            const issued = {
                ...original,
                payment_id: 1,
                payment_amount: 1000,
                payment_currency: "CNY",
                handling_amount: 0,
            };
            view.rerender(checkout(issued));
            expect(screen.getByRole("textbox", { name: "付款内容" })).toBe(
                qrContent,
            );
            expect(qrContent.value).toBe("https://example.test/snapshot-qr");
            view.rerender(
                checkout({
                    ...issued,
                    payment_amount: amount,
                    payment_currency: currency,
                }),
            );
            await screen.findByDisplayValue("new-authoritative-qr");
            expect(screen.queryByDisplayValue("https://example.test/snapshot-qr")).toBeNull();
            expect(
                screen.queryByRole("button", { name: "确认支付" }),
            ).toBeNull();
            expect(
                screen
                    .getByRole("radio", { name: "Alipay" })
                    .closest("fieldset")?.disabled,
            ).toBe(true);
            expect(onQuoteChange).toHaveBeenLastCalledWith({
                amount,
                currency,
                fee: 0,
            });
            expect(
                mock.request.mock.calls.filter(
                    ([path, body]) => path === "user/order/checkout" && !body?.resume_payment,
                ),
            ).toHaveLength(1);
        } finally {
            mock.methods = old;
        }
    },
);

it.each([
    { label: "issued in another tab", status: 0, payment_id: 1 },
    { label: "completed", status: 3, payment_id: 1 },
])(
    "ignores a late card token from an older render after the payment is $label",
    async ({ status, payment_id }) => {
        const old = mock.methods;
        mock.methods = [
            {
                id: 1,
                name: "Card",
                payment: "StripeCredit",
                handling_fee_fixed: 0,
                quoted_amount: 1000,
                quoted_currency: "CNY",
                quoted_fee: 0,
            } as any,
        ];
        try {
            mock.request.mockResolvedValue({ data: 0 });
            let oldPayToken: ((token: string) => Promise<void>) | undefined;
            const renderCard = vi.fn(
                (
                    _method: number,
                    payToken: (token: string) => Promise<void>,
                ) => {
                    oldPayToken ??= payToken;
                    return <p>Test card ready</p>;
                },
            );
            const reload = vi.fn();
            const original = {
                status: 0,
                plan_id: 1,
                total_amount: 1000,
                currency: "CNY",
                trade_no: "late-card-token-order",
                plan: { name: "Plan" },
            };
            const checkout = (order: Record<string, unknown>) => (
                <PaymentCheckout
                    order={order}
                    reload={reload}
                    renderCard={renderCard}
                />
            );
            const view = render(checkout(original));
            fireEvent.click(
                await screen.findByRole("button", { name: "确认支付" }),
            );
            await screen.findByText("Test card ready");
            expect(oldPayToken).toBeTypeOf("function");
            expect(
                mock.request.mock.calls.filter(
                    ([path]) => path === "user/order/checkout",
                ),
            ).toHaveLength(0);
            view.rerender(
                checkout({
                    ...original,
                    status,
                    payment_id,
                    payment_amount: 1000,
                    payment_currency: "CNY",
                    handling_amount: 0,
                }),
            );
            expect(screen.queryByText("Test card ready")).toBeNull();
            await act(async () => {
                await oldPayToken!("late-token");
            });
            expect(
                mock.request.mock.calls.filter(
                    ([path, body]) => path === "user/order/checkout" && !body?.resume_payment,
                ),
            ).toHaveLength(0);
        } finally {
            mock.methods = old;
        }
    },
);

it("rejects a previous card session's token after closing and reopening the same channel", async () => {
    const old = mock.methods;
    mock.methods = [
        {
            id: 1,
            name: "Card",
            payment: "StripeCredit",
            handling_fee_fixed: 0,
            quoted_amount: 1000,
            quoted_currency: "CNY",
            quoted_fee: 0,
        } as any,
    ];
    try {
        mock.request.mockImplementation(async (path: string) =>
            path === "user/order/checkout"
                ? { type: 0, data: "https://example.test/current-card-qr" }
                : { data: 0 },
        );
        const cardCallbacks: ((token: string) => Promise<void>)[] = [];
        const renderCard = (
            _method: number,
            payToken: (token: string) => Promise<void>,
        ) => {
            cardCallbacks.push(payToken);
            return <p>Test card ready</p>;
        };
        render(
            <PaymentCheckout
                order={{
                    status: 0,
                    plan_id: 1,
                    total_amount: 1000,
                    currency: "CNY",
                    trade_no: "reopened-card-order",
                    plan: { name: "Plan" },
                }}
                reload={vi.fn()}
                renderCard={renderCard}
            />,
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "确认支付" }),
        );
        await screen.findByText("Test card ready");
        const previousSession = cardCallbacks.at(-1)!;
        fireEvent.click(screen.getByRole("button", { name: "关闭" }));
        expect(screen.queryByText("Test card ready")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
        await screen.findByText("Test card ready");
        const currentSession = cardCallbacks.at(-1)!;
        await act(async () => {
            await previousSession("stale-session-token");
        });
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(0);
        expect(screen.getByText("Test card ready")).toBeTruthy();
        await act(async () => {
            await currentSession("current-session-token");
        });
        expect(mock.request).toHaveBeenCalledWith(
            "user/order/checkout",
            expect.objectContaining({
                method: 1,
                token: "current-session-token",
            }),
            { timeoutMs: 45000 },
        );
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(1);
    } finally {
        mock.methods = old;
    }
});

it("ignores an unfinished card token callback after leaving the payment component", async () => {
    const old = mock.methods;
    mock.methods = [
        {
            id: 1,
            name: "Card",
            payment: "StripeCredit",
            handling_fee_fixed: 0,
            quoted_amount: 1000,
            quoted_currency: "CNY",
            quoted_fee: 0,
        } as any,
    ];
    try {
        mock.request.mockResolvedValue({
            type: 0,
            data: "https://example.test/unmounted-card-qr",
        });
        let oldPayToken: ((token: string) => Promise<void>) | undefined;
        const view = render(
            <PaymentCheckout
                order={{
                    status: 0,
                    plan_id: 1,
                    total_amount: 1000,
                    currency: "CNY",
                    trade_no: "unmounted-card-order",
                    plan: { name: "Plan" },
                }}
                reload={vi.fn()}
                renderCard={(_method, payToken) => {
                    oldPayToken = payToken;
                    return <p>Test card ready</p>;
                }}
            />,
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "确认支付" }),
        );
        await screen.findByText("Test card ready");
        const unfinishedCallback = oldPayToken!;
        view.unmount();
        await act(async () => {
            await unfinishedCallback("unmounted-token");
        });
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(0);
    } finally {
        mock.methods = old;
    }
});

// All payment actions below are synthetic. Prevent anchor navigation after React's
// click handler runs, so repeated-open tests cannot leave the test document.
function clickSyntheticPaymentLink(link: HTMLElement) {
    document.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
    });
    fireEvent.click(link);
}
function renderMobilePayment(provider = "AlipayF2F", reload = vi.fn()) {
    vi.stubGlobal("innerWidth", 390);
    mock.methods = [
        {
            id: 1,
            name: "Alipay",
            payment: provider,
            category: "wallet",
            handling_fee_fixed: 0,
            quoted_amount: 1000,
            quoted_currency: "CNY",
            quoted_fee: 0,
        } as any,
    ];
    return render(
        <PaymentCheckout
            compact
            embedded
            order={{
                status: 0,
                plan_id: 1,
                total_amount: 1000,
                currency: "CNY",
                trade_no: "synthetic-mobile-order",
                plan: { name: "Plan" },
            }}
            reload={reload}
            renderCard={() => null}
        />,
    );
}

it.each([
    "https://pay.example.test/checkout?token=owned",
    "http://gateway.example.test/pay?id=1",
    "alipays://platformapi/startapp?appId=20000067&url=https%3A%2F%2Fexample.test",
    "alipay://platformapi/startapp?appId=20000067",
    "weixin://wap/pay?prepayid=wx123",
])(
    "accepts an explicit payment action with an allowed protocol and route: %s",
    (value) => {
        expect(paymentActionUrl(value)).toBe(value);
    },
);
it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "intent://pay/#Intent;scheme=alipay;end",
    "file:///tmp/payment",
    "unknown-wallet://pay/order",
    "/relative-pay",
    "//pay.example.test/checkout",
    "https://user:secret@pay.example.test/checkout",
    "https://pay.example.test/\r\nunsafe",
    "\nhttps://pay.example.test/checkout",
    "alipays://platformapi/other?appId=20000067",
    "alipays://unrelated/startapp?appId=20000067",
    "alipay://platformapi/startapp.evil?appId=20000067",
    "weixin://dl/business/?t=123",
    "weixin://wap/pay/extra?prepayid=wx123",
    "",
])("rejects unsafe or unsupported payment actions: %s", (value) => {
    expect(paymentActionUrl(value)).toBeFalsy();
});
it.each([
    ["https://qr.alipay.com/bax0123456789", "AlipayF2F", true],
    ["https://qr.alipay.com/bax0123456789", "Coinbase", false],
    ["https://unrelated.example.test/qr", "AlipayF2F", false],
    ["https://qr.alipay.com.evil.test/qr", "AlipayF2F", false],
    ["https://qr.alipay.com@evil.test/qr", "AlipayF2F", false],
    ["https://user:secret@qr.alipay.com/qr", "AlipayF2F", false],
    ["http://qr.alipay.com/bax0123456789", "AlipayF2F", false],
    ["weixin://wap/pay?prepayid=wx123", "AlipayF2F", false],
    ["TQsyntheticWalletAddress", "AlipayF2F", false],
    ["javascript:alert(1)", "AlipayF2F", false],
])(
    "only creates a direct QR action for a supported provider and official HTTPS content: %s / %s",
    (value, provider, allowed) => {
        const action = qrPaymentActionUrl(value, provider);
        if (allowed) expect(action).toBe(value);
        else expect(action).toBeFalsy();
    },
);

it("opens an existing mobile redirect payment without starting another checkout", async () => {
    const target = "https://gateway.example.test/pay/owned-order";
    mock.request.mockImplementation(async (path: string) =>
        path === "user/order/checkout"
            ? { type: 1, data: target }
            : { data: 0 },
    );
    const reload = vi.fn();
    renderMobilePayment("EPay", reload);
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    const action = await screen.findByRole("link", { name: "openPayment" });
    expect(action.getAttribute("href")).toBe(target);
    for (let i = 0; i < 3; i++) clickSyntheticPaymentLink(action);
    expect(mock.trackCopyFailure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "checkPayment" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(
        mock.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(1);
    expect(
        mock.request.mock.calls.filter(([path]) => path === "user/order/save"),
    ).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
});
it("keeps a desktop MGate redirect on the checkout page until the customer opens the payment link", async () => {
    vi.stubGlobal("innerWidth", 1280);
    const assign = vi.fn();
    vi.stubGlobal("location", { href: "https://panel.example.test/app", assign });
    mock.methods = [{ id: 11, name: "MGate", payment: "MGate", handling_fee_fixed: 0 } as any];
    const target = "https://gateway.example.test/cashier/owned-order";
    mock.request.mockImplementation(async (path: string) =>
        path === "user/order/checkout" ? { type: 1, data: target } : { data: 0 },
    );
    renderCheckout();
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    const link = await screen.findByRole("link", { name: "openPayment" });
    expect(link.getAttribute("href")).toBe(target);
    expect(link.closest(".checkout-confirm")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "checkPayment" }).classList.contains("checkout-check-result")).toBe(true);
    expect(screen.queryByRole("button", { name: "reselectPayment" })).toBeNull();
    clickSyntheticPaymentLink(link);
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});
it("offers a mobile action for an official supported Alipay QR while retaining its payment state", async () => {
    const target = "https://qr.alipay.com/bax0123456789";
    mock.request.mockImplementation(async (path: string) =>
        path === "user/order/checkout"
            ? { type: 0, data: target }
            : { data: 0 },
    );
    renderMobilePayment();
    fireEvent.click(await screen.findByRole("button", { name: "确认支付" }));
    const action = await screen.findByRole("link", { name: "openPayment" });
    expect(action.getAttribute("href")).toBe(target);
    expect(screen.getByDisplayValue(target)).toBeTruthy();
    clickSyntheticPaymentLink(action);
    clickSyntheticPaymentLink(action);
    expect(screen.getByText("mobileScanHelp")).toBeTruthy();
    expect(mock.trackCopyFailure).not.toHaveBeenCalled();
    expect(
        mock.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
        ),
    ).toHaveLength(1);
});
it.each([
    [1, "javascript:alert(1)"],
    [1, "intent://pay/#Intent;scheme=alipay;end"],
    [1, "https://user:secret@gateway.example.test/pay"],
    [0, "https://qr.alipay.com.evil.test/pay"],
    [0, "https://unrelated.example.test/pay"],
    [0, "TQsyntheticWalletAddress"],
])(
    "does not create a mobile action for unsafe redirect or unrelated QR data: type %s",
    async (type, value) => {
        mock.request.mockImplementation(async (path: string) =>
            path === "user/order/checkout"
                ? { type, data: value }
                : { data: 0 },
        );
        renderMobilePayment();
        await act(async () => {
            fireEvent.click(
                await screen.findByRole("button", { name: "确认支付" }),
            );
        });
        expect(screen.queryByRole("link", { name: "openPayment" })).toBeNull();
        if (type === 0) expect(screen.getByDisplayValue(value)).toBeTruthy();
        expect(mock.trackCopyFailure).not.toHaveBeenCalled();
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(1);
    },
);
it.each([true, false])(
    "keeps copying unknown mobile QR data available and reports only failures: %s",
    async (succeeds) => {
        const content = "TQsyntheticWalletAddress";
        const copy = succeeds
            ? vi.fn().mockResolvedValue(undefined)
            : vi.fn().mockRejectedValue(new Error("denied"));
        mock.request.mockImplementation(async (path: string) =>
            path === "user/order/checkout"
                ? { type: 0, data: content }
                : { data: 0 },
        );
        renderMobilePayment("CoinPayments");
        vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
        fireEvent.click(
            await screen.findByRole("button", { name: "确认支付" }),
        );
        const action = await screen.findByRole("button", {
            name: "copyPayment",
        });
        fireEvent.click(action);
        if (succeeds) {
            expect(await screen.findByText("paymentCopied")).toBeTruthy();
            expect(mock.trackCopyFailure).not.toHaveBeenCalled();
        } else {
            await waitFor(() => expect(mock.trackCopyFailure).toHaveBeenCalledExactlyOnceWith("payment"));
        }
        expect(copy).toHaveBeenCalledWith(content);
        expect(screen.queryByRole("link", { name: "openPayment" })).toBeNull();
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(1);
    },
);


it.each([
    "alipays://platformapi/startapp?appId=20000067&appId=999&url=https%3A%2F%2Fexample.test",
    "alipays://platformapi/startapp?appId=20000067&saId=10000007",
    "alipays://platformapi/startapp?appId=20000067&url=javascript%3Aalert(1)",
    "alipays://platformapi/startapp?saId=10000007&qrcode=https%3A%2F%2Funtrusted.example%2Fpay",
    "weixin://wap/pay?other=value",
])("rejects ambiguous wallet actions and non-payment nested targets: %s", value => {
    expect(paymentActionUrl(value)).toBeUndefined();
});
it("does not promote extra parameters on an official QR origin into a payment entry", () => {
    expect(qrPaymentActionUrl("https://qr.alipay.com/bax0123456789?url=https%3A%2F%2Fevil.example", "AlipayF2F")).toBeUndefined();
});
it("preserves scan-only native WeChat responses without treating them as an H5 action", async () => {
    const code = "weixin://wxpay/bizpayurl?pr=synthetic-native-order";
    mock.request.mockImplementation(async path => path === "user/order/checkout" ? {type:1,data:code} : {data:0});
    renderMobilePayment("EPayQrcode");
    fireEvent.click(await screen.findByRole("button", {name:"确认支付"}));
    await screen.findByDisplayValue(code);
    expect(screen.queryByRole("link", {name:"openPayment"})).toBeNull();
    expect(screen.getByRole("button", {name:"copyPayment"})).toBeTruthy();
    expect(screen.getByRole("button", {name:"checkPayment"})).toBeTruthy();
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});
it("keeps a rejected redirect response locked for status recovery without exposing its URL", async () => {
    mock.request.mockImplementation(async path => path === "user/order/checkout" ? {type:1,data:"javascript:alert(1)"} : {data:0});
    renderMobilePayment("EPayQrcode");
    fireEvent.click(await screen.findByRole("button", {name:"确认支付"}));
    await screen.findByText("此支付方式需要专用客户端，请选择其他方式。");
    expect(screen.queryByRole("link", {name:"openPayment"})).toBeNull();
    expect(screen.queryByRole("button", {name:"确认支付"})).toBeNull();
    expect(screen.getByRole("button", {name:"checkPayment"})).toBeTruthy();
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});
