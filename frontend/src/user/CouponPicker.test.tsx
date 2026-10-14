// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
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
    wallet: [] as any[],
    offers: [] as any[],
}));
vi.mock("../shared/api", () => ({ request: mocks.request }));
vi.mock("../shared/i18n", () => ({
    locale: () => "zh-CN",
    tx: (s: string) => s,
}));
vi.mock("../shared/ui", () => ({
    State: ({ children }: any) => children,
    useData: (path: string) => ({
        data: path.endsWith("/wallet") ? mocks.wallet : mocks.offers,
        reload: mocks.reload,
        error: "",
        loading: false,
    }),
}));
import { CouponPicker } from "./CouponPicker";
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
    vi.clearAllMocks();
    mocks.wallet = [];
    mocks.offers = [];
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
    fireEvent.click(screen.getByRole("radio", { name: /Welcome/ }));
    expect(change).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("textbox")).toBeNull();
});
it("disables expired, used and ineligible coupons", () => {
    mocks.wallet = [
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
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0].disabled).toBe(false);
    expect(radios.slice(1).every((r) => r.disabled)).toBe(true);
});
it("keeps public claiming outside checkout and links to activities and wallet", () => {
    mocks.offers = [coupon];
    render(
        <CouponPicker
            planId={1}
            period="month_price"
            value={null}
            onChange={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("link", { name: "查看活动" }).getAttribute("href"),
    ).toBe("#/activities");
    expect(
        screen.getByRole("link", { name: "管理优惠券" }).getAttribute("href"),
    ).toBe("#/coupons");
    expect(screen.queryByRole("button", { name: /领取/ })).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
});
