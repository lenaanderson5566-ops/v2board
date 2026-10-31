// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    reload: vi.fn(),
    wallet: [] as any[],
    offers: [] as any[],
    error: "",
    loading: false,
    retryAt: 0,
}));
vi.mock("../shared/api", () => ({
    boot: { mode: "user" },
    request: mocks.request,
    money: (n: number, currency: string) =>
        `${currency} ${(n / 100).toFixed(2)}`,
}));
vi.mock("./pricing-copy", () => ({
    pricingCopy: (key: string, args: any = {}) => `${key} ${args.amount || ""}`,
}));
vi.mock("../shared/i18n", () => ({
    locale: () => "zh-CN",
    tx: (s: string) => s,
}));
vi.mock("../shared/ui", () => ({
    State: ({ children, error, retry }: any) =>
        error ? (
            <div role="alert">
                {error}
                <button onClick={retry}>重试</button>
            </div>
        ) : (
            children
        ),
    useData: (path: string) => ({
        data: path.endsWith("/wallet") ? mocks.wallet : mocks.offers,
        reload: mocks.reload,
        error: mocks.error,
        loading: mocks.loading,
        retryAt: mocks.retryAt,
    }),
}));
import { CouponPicker } from "./CouponPicker";
import { configureTimeZone, setDisplayTimeZone } from "../shared/timezone";
const coupon = {
    id: 1,
    name: "Welcome",
    discountPercent: 10,
    expiresAt: "2030-01-01T00:00:00Z",
    status: "available",
    planIds: [],
    billingPeriods: [],
};
afterEach(() => {
    cleanup();
    setDisplayTimeZone(null);
    vi.clearAllMocks();
    mocks.wallet = [];
    mocks.offers = [];
    mocks.error = "";
    mocks.loading = false;
    mocks.retryAt = 0;
});
it("selects a wallet entry without entering a coupon code", () => {
    mocks.wallet = [coupon];
    const change = vi.fn();
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={change}
        />,
    );
    fireEvent.click(
        screen.getByLabelText("我的优惠券", { selector: "summary" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Welcome/ }));
    expect(change).toHaveBeenCalledWith(1, coupon);
    expect(screen.queryByRole("textbox")).toBeNull();
});
it("applies inline immediately and restores focus without opening a dialog", () => {
    mocks.wallet = [coupon];
    const change = vi.fn();
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={change}
        />,
    );
    const trigger = screen.getByLabelText("我的优惠券", {
        selector: "summary",
    });
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Welcome/ }));
    expect(change).toHaveBeenCalledWith(1, coupon);
    expect(trigger.closest("details")?.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("button", { name: "确认选择" })).toBeNull();
});
it("immediately opts out of a selected coupon", () => {
    mocks.wallet = [coupon];
    const change = vi.fn();
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={1}
            onChange={change}
        />,
    );
    fireEvent.click(
        screen.getByLabelText("我的优惠券", { selector: "summary" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "不使用优惠券" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(change).toHaveBeenCalledWith(null, undefined);
});
it("disables expired, used and ineligible coupons", () => {
    mocks.wallet = [
        { ...coupon, id: 5 },
        { ...coupon, id: 1, status: "expired" },
        { ...coupon, id: 2, status: "reservedOrUsed" },
        { ...coupon, id: 3, planIds: [2] },
        { ...coupon, id: 4, billingPeriods: ["annual"] },
    ];
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={vi.fn()}
        />,
    );
    fireEvent.click(
        screen.getByLabelText("我的优惠券", { selector: "summary" }),
    );
    fireEvent.click(screen.getByText("unavailableCoupons", { exact: false }));
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0].disabled).toBe(false);
    expect(radios[1].disabled).toBe(false);
    expect(radios.slice(2).every((r) => r.disabled)).toBe(true);
});
it("keeps empty checkout compact without activity detours or claiming operations", () => {
    mocks.offers = [coupon];
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={vi.fn()}
        />,
    );
    expect(screen.queryByText("暂无优惠券")).toBeNull();
    expect(screen.queryByText("我的优惠券")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /领取/ })).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
});

it("sorts usable coupons by savings, previews integer-cent discounts and clears incompatible selection", () => {
    mocks.wallet = [
        coupon,
        { ...coupon, id: 2, name: "Better", discountPercent: 25 },
    ];
    const change = vi.fn();
    const view = render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={1}
            onChange={change}
            amount={999}
            currency="USD"
        />,
    );
    fireEvent.click(
        screen.getByLabelText("我的优惠券", { selector: "summary" }),
    );
    expect(
        screen.getAllByRole("radio")[1].closest("label")?.textContent,
    ).toContain("Better");
    expect(
        screen.getByRole("radio", { name: /couponSaving USD 2.49/ }),
    ).toBeTruthy();
    mocks.wallet = [{ ...coupon, planIds: [1] }];
    view.rerender(
        <CouponPicker
            planId={2}
            period="month_price"
            value={1}
            onChange={change}
        />,
    );
    expect(change).toHaveBeenCalledWith(null);
});

it("shows selected savings collapsed without automatically choosing another coupon", () => {
    mocks.wallet = [coupon, { ...coupon, id: 2, discountPercent: 25 }];
    const change = vi.fn();
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={1}
            amount={999}
            currency="USD"
            onChange={change}
        />,
    );
    const summary = screen.getByLabelText("我的优惠券", {
        selector: "summary",
    });
    expect(summary.textContent).toContain("USD 0.99");
    expect(summary.closest("details")?.open).toBe(false);
    expect(change).not.toHaveBeenCalled();
});

it.each([
    { status: "expired" },
    { status: "reservedOrUsed" },
    { planIds: [2] },
    { billingPeriods: ["annual"] },
])(
    "hides checkout coupon entry when no coupon is usable: %j",
    (restriction) => {
        mocks.wallet = [{ ...coupon, ...restriction }];
        const { container } = render(
            <CouponPicker
                planId={1}
                period="month_price"
                value={null}
                onChange={vi.fn()}
            />,
        );
        expect(container.childElementCount).toBe(0);
    },
);
it("hides the entry while loading and retains retry when the wallet fails", () => {
    mocks.loading = true;
    const view = render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={vi.fn()}
        />,
    );
    expect(view.container.childElementCount).toBe(0);
    mocks.loading = false;
    mocks.error = "Wallet unavailable";
    view.rerender(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={vi.fn()}
        />,
    );
    expect(screen.getByRole("status").textContent).toContain("couponUnavailable");
    expect(screen.queryByText("Wallet unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.reload).toHaveBeenCalledOnce();
});
it("keeps coupon failures secondary and waits before allowing a rate-limit retry", async () => {
    vi.useFakeTimers();
    try {
        mocks.error = "Too Many Attempts.";
        mocks.retryAt = Date.now() + 2000;
        render(<CouponPicker planId={1} period="month_price" value={null} onChange={vi.fn()} />);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByText("Too Many Attempts.")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /retryIn/ }));
        expect(mocks.reload).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        fireEvent.click(screen.getByRole("button", { name: "重试" }));
        expect(mocks.reload).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
});

it("previews available savings without applying them or suggesting that a discount is already included", () => {
    mocks.wallet = [coupon, { ...coupon, id: 2, discountPercent: 25 }];
    const change = vi.fn();
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            amount={999}
            currency="USD"
            onChange={change}
        />,
    );
    const summary = screen.getByLabelText("我的优惠券", {
        selector: "summary",
    });
    expect(summary.textContent).toContain("couponAvailableSaving USD 2.49");
    expect(summary.textContent).not.toContain("不使用优惠券");
    expect(summary.getAttribute("aria-describedby")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
});
it("resolves coupon intent from the current wallet once after it finishes loading", () => {
    mocks.wallet = [coupon];
    mocks.loading = true;
    const change = vi.fn();
    const view = render(<CouponPicker planId={1} period="month_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).not.toHaveBeenCalled();
    mocks.loading = false;
    view.rerender(<CouponPicker planId={1} period="month_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).toHaveBeenCalledExactlyOnceWith(1, coupon);
    view.rerender(<CouponPicker planId={1} period="month_price" value={1} couponIntentId={1} onChange={change} />);
    view.rerender(<CouponPicker planId={1} period="month_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).toHaveBeenCalledTimes(1);
});
it("respects a manual opt-out across wallet refreshes and cycle changes", () => {
    mocks.wallet = [coupon];
    const change = vi.fn(), manual = vi.fn();
    const view = render(<CouponPicker planId={1} period="month_price" value={null} couponIntentId={1} onChange={change} onManualChange={manual} />);
    view.rerender(<CouponPicker planId={1} period="month_price" value={1} couponIntentId={1} onChange={change} onManualChange={manual} />);
    fireEvent.click(screen.getByLabelText("我的优惠券", { selector: "summary" }));
    fireEvent.click(screen.getByRole("radio", { name: "不使用优惠券" }));
    expect(manual).toHaveBeenCalledOnce();
    expect(change).toHaveBeenLastCalledWith(null, undefined);
    mocks.wallet = [{ ...coupon }];
    view.rerender(<CouponPicker planId={1} period="year_price" value={null} couponIntentId={1} onChange={change} onManualChange={manual} />);
    expect(change).toHaveBeenCalledTimes(2);
});
it.each([
    { id: 9 },
    { status: "expired" },
    { status: "reservedOrUsed" },
    { expiresAt: "2020-01-01T00:00:00Z" },
    { expiresAt: "invalid" },
    { planIds: [2] },
])("does not apply unowned, expired or incompatible wallet intent: %j", (restriction) => {
    mocks.wallet = [{ ...coupon, ...restriction }];
    const change = vi.fn();
    render(<CouponPicker planId={1} period="month_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).not.toHaveBeenCalled();
});
it("does not force an incompatible cycle and can apply intent once the user chooses an eligible cycle", () => {
    mocks.wallet = [{ ...coupon, billingPeriods: ["annual"] }];
    const change = vi.fn();
    const view = render(<CouponPicker planId={1} period="month_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).not.toHaveBeenCalled();
    view.rerender(<CouponPicker planId={1} period="year_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).toHaveBeenCalledExactlyOnceWith(1, mocks.wallet[0]);
    view.rerender(<CouponPicker planId={1} period="month_price" value={1} couponIntentId={1} onChange={change} />);
    expect(change).toHaveBeenLastCalledWith(null);
    view.rerender(<CouponPicker planId={1} period="year_price" value={null} couponIntentId={1} onChange={change} />);
    expect(change).toHaveBeenCalledTimes(2);
});
it("does not replace a coupon that the user already selected", () => {
    mocks.wallet = [coupon, { ...coupon, id: 2 }];
    const change = vi.fn();
    render(<CouponPicker planId={1} period="month_price" value={2} couponIntentId={1} onChange={change} />);
    expect(change).not.toHaveBeenCalled();
});

it("shows wallet expiry in the personal zone without verbose seconds", () => {
    configureTimeZone("UTC"); setDisplayTimeZone("Asia/Kathmandu");
    mocks.wallet = [{ ...coupon, expiresAt: "2027-08-30T00:08:37Z" }];
    const view = render(<CouponPicker planId={1} period="month_price" value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("我的优惠券", { selector: "summary" }));
    expect(view.container.textContent).toContain("2027/08/30 05:53 (UTC+5:45)");
    expect(view.container.textContent).not.toContain("05:53:37");
});
