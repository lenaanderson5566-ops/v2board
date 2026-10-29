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
    trackAction: vi.fn(),
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
    useData: () => ({ data: mock.methods, loading: false, reload: vi.fn() }),
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
    trackAction: mock.trackAction,
}));
vi.mock("./PurchaseSteps", () => ({ PurchaseSteps: () => null }));
vi.mock("./OrderHelp", () => ({ OrderHelp: () => null }));
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
    await screen.findByText("正在等待支付确认，请勿重复付款。");
    expect(
        screen.getByRole("radio", { name: /BSC/ }).closest("fieldset")
            ?.disabled,
    ).toBe(true);
});

it.each(["NETWORK_ERROR", "REQUEST_TIMEOUT"])(
    "checks status without resubmitting after %s",
    async (code) => {
        mock.request.mockImplementation((path: string) =>
            path === "user/order/checkout"
                ? Promise.reject(
                      Object.assign(new Error("Load failed"), { code }),
                  )
                : Promise.resolve({ data: 0 }),
        );
        const reload = vi.fn();
        renderCheckout({ trade_no: "uncertain" }, reload);
        fireEvent.click(
            await screen.findByRole("button", { name: "确认支付" }),
        );
        await screen.findByText(
            "未能确认支付请求结果，正在检查订单状态，请勿重复付款。",
        );
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
        fireEvent.click(screen.getByRole("button", { name: "检查支付结果" }));
        expect(reload).toHaveBeenCalled();
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "重新发起支付" }));
        fireEvent.click(
            screen.getAllByRole("button", { name: "重新发起支付" }).at(-1)!,
        );
        await screen.findByRole("button", { name: "确认支付" });
        expect(
            screen.queryByText(
                "未能确认支付请求结果，正在检查订单状态，请勿重复付款。",
            ),
        ).toBeNull();
        expect(screen.getByRole("button", { name: "确认支付" })).toBeTruthy();
    },
);

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
    mock.request.mockResolvedValue({ data: 0 });
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
    await screen.findByText("正在等待支付确认，请勿重复付款。");
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
    expect(screen.getByText("正在等待支付确认，请勿重复付款。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认支付" })).toBeNull();
    expect(
        (screen.getByRole("radio", { name: /TRON/ }) as HTMLInputElement)
            .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "检查支付结果" }));
    expect(reload).toHaveBeenCalled();
    expect(
        mock.request.mock.calls.filter(
            ([path]) => path === "user/order/checkout",
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
                        name: "检查支付结果",
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
            mock.request.mockImplementation(async (path: string) =>
                path === "user/order/checkout"
                    ? { type: 0, data: "https://example.test/snapshot-qr" }
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
            await waitFor(() =>
                expect(
                    screen.queryByRole("textbox", { name: "付款内容" }),
                ).toBeNull(),
            );
            expect(
                screen.getByText("正在等待支付确认，请勿重复付款。"),
            ).toBeTruthy();
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
                    ([path]) => path === "user/order/checkout",
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
                    ([path]) => path === "user/order/checkout",
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
    expect(
        mock.trackAction.mock.calls.filter(
            ([event]) => event === "payment_open",
        ),
    ).toHaveLength(3);
    expect(mock.trackAction).toHaveBeenCalledWith("payment_open", "payment");
    fireEvent.click(screen.getByRole("button", { name: "检查支付结果" }));
    expect(reload).toHaveBeenCalled();
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
    expect(screen.getByText("正在等待支付确认，请勿重复付款。")).toBeTruthy();
    expect(mock.trackAction).toHaveBeenCalledWith("payment_open", "payment");
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
        expect(
            mock.trackAction.mock.calls.filter(
                ([event]) => event === "payment_open",
            ),
        ).toHaveLength(0);
        expect(
            mock.request.mock.calls.filter(
                ([path]) => path === "user/order/checkout",
            ),
        ).toHaveLength(1);
    },
);
it.each([true, false])(
    "keeps copying unknown mobile QR data available and records its result: %s",
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
        await waitFor(() =>
            expect(mock.trackAction).toHaveBeenCalledWith(
                succeeds ? "copy_success" : "copy_failed",
                "payment",
            ),
        );
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
    expect(screen.getByRole("button", {name:"检查支付结果"})).toBeTruthy();
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});
it("keeps a rejected redirect response locked for status recovery without exposing its URL", async () => {
    mock.request.mockImplementation(async path => path === "user/order/checkout" ? {type:1,data:"javascript:alert(1)"} : {data:0});
    renderMobilePayment("EPayQrcode");
    fireEvent.click(await screen.findByRole("button", {name:"确认支付"}));
    await screen.findByText("此支付方式需要专用客户端，请选择其他方式。");
    expect(screen.queryByRole("link", {name:"openPayment"})).toBeNull();
    expect(screen.queryByRole("button", {name:"确认支付"})).toBeNull();
    expect(screen.getByRole("button", {name:"检查支付结果"})).toBeTruthy();
    expect(mock.request.mock.calls.filter(([path]) => path === "user/order/checkout")).toHaveLength(1);
});
