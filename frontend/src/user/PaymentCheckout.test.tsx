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
vi.mock("./PurchaseSteps", () => ({ PurchaseSteps: () => null }));
vi.mock("./OrderHelp", () => ({ OrderHelp: () => null }));
vi.mock("./OrderReceipt", () => ({ OrderReceipt: () => null }));
vi.mock("../shared/credit-copy", () => ({
    c: (value: string) => value,
    minuteDate: () => "",
}));
import { PaymentCheckout, type PaymentQuote } from "./PaymentCheckout";
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
