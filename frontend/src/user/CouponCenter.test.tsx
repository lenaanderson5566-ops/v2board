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
vi.mock("./pricing-copy", () => ({ pricingCopy: (key: string) => key }));
vi.mock("../shared/api", () => ({ request: mocks.request }));
vi.mock("../shared/i18n", () => ({
    locale: () => "en-US",
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
import { ActivityCenter, MyCoupons } from "./CouponCenter";
const coupon = {
    id: 1,
    name: "Welcome",
    activityTitle: "Welcome offer",
    activityDescription: "Terms <script>alert(1)</script>",
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
it("renders localized activity copy as plain text", () => {
    mocks.offers = [coupon];
    const { container } = render(<ActivityCenter />);
    expect(screen.getByRole("heading", { name: "Welcome offer" })).toBeTruthy();
    expect(screen.getByText(coupon.activityDescription)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
});
it("claims once during rapid clicks and refreshes offers", async () => {
    mocks.offers = [coupon];
    let done: (v: any) => void = () => {};
    mocks.request.mockImplementation(
        () =>
            new Promise((resolve) => {
                done = resolve;
            }),
    );
    render(<ActivityCenter />);
    const button = screen.getByRole("button", { name: "领取优惠券" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    done({ data: { id: 3 } });
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
    expect(mocks.request).toHaveBeenCalledWith("user/coupon/claim", {
        coupon_id: 1,
    });
    expect(screen.getByRole("status").textContent).toContain("领取成功");
    expect(
        screen.getByRole("button", { name: "已领取" }).hasAttribute("disabled"),
    ).toBe(true);
});
it("retains an offer after failure so it can be retried", async () => {
    mocks.offers = [coupon];
    mocks.request.mockRejectedValue(new Error("库存不足"));
    render(<ActivityCenter />);
    fireEvent.click(screen.getByRole("button", { name: "领取优惠券" }));
    expect((await screen.findByRole("alert")).textContent).toBe("库存不足");
    await waitFor(() =>
        expect(
            screen
                .getByRole("button", { name: "领取优惠券" })
                .hasAttribute("disabled"),
        ).toBe(false),
    );
    expect(mocks.reload).not.toHaveBeenCalled();
});
it("offers an activity entry when wallet is empty and offers exist", () => {
    mocks.offers = [coupon];
    render(<MyCoupons />);
    expect(
        screen.getByRole("link", { name: "前往活动中心" }).getAttribute("href"),
    ).toBe("#/activities");
});
it("hides the activity entry when no offers exist and avoids repeating the page title", () => {
    render(<MyCoupons />);
    expect(screen.queryByRole("link", { name: "前往活动中心" })).toBeNull();
    expect(screen.getByRole("link", { name: "购买订阅" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "我的优惠券" })).toBeNull();
});
it("distinguishes an empty category from an empty wallet", () => {
    mocks.wallet = [{ ...coupon, name: "Expired", status: "expired" }];
    render(<MyCoupons />);
    expect(screen.getByRole("heading", { name: "当前分类暂无优惠券" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^已过期/ }));
    expect(screen.getByRole("heading", { name: "Expired" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "选择套餐使用" })).toBeNull();
});
it("only available wallet entries have a purchase link", () => {
    mocks.wallet = [
        coupon,
        { ...coupon, id: 2, name: "Expired", status: "expired" },
        { ...coupon, id: 3, name: "Used", status: "reservedOrUsed" },
    ];
    render(<MyCoupons />);
    expect(screen.getAllByRole("link", { name: "选择套餐使用" })).toHaveLength(
        1,
    );
    fireEvent.click(screen.getByRole("button", { name: /^已过期/ }));
    expect(screen.getByRole("heading", { name: "Expired" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "选择套餐使用" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^已占用或使用/ }));
    expect(screen.getByRole("heading", { name: "Used" })).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("carries only a safe wallet coupon ID into the plan catalog", () => {
    mocks.wallet = [{ ...coupon, code: "private-code", token: "private-token", planIds: [2], billingPeriods: ["annual"] }];
    render(<MyCoupons />);
    expect(screen.getByRole("link", { name: "选择套餐使用" }).getAttribute("href")).toBe("#/plan?couponId=1");
});
it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, "1&pay=true"])("does not offer a purchase intent for an unsafe coupon ID: %s", (id) => {
    mocks.wallet = [{ ...coupon, id }];
    render(<MyCoupons />);
    expect(screen.queryByRole("link", { name: "选择套餐使用" })).toBeNull();
});
it("does not send an expired coupon into checkout even if the wallet status is stale", () => {
    mocks.wallet = [{ ...coupon, expiresAt: "2020-01-01T00:00:00Z" }];
    render(<MyCoupons />);
    expect(screen.queryByRole("link", { name: "选择套餐使用" })).toBeNull();
});
