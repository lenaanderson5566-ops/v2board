// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../shared/api", () => ({
    admin: (path: string) => path,
    request: api.request,
}));
vi.mock("../shared/ui", () => ({
    useData: (path: string) => ({
        loading: false,
        error: "",
        reload: vi.fn(),
        data: path.startsWith("coupon/")
            ? [{ id: 7, name: "Ten percent", type: 2, value: 10, show: 1 }]
            : [{ id: 7, name: "Basic" }],
    }),
    State: ({ children }: { children: React.ReactNode }) => children,
    Modal: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
}));
vi.mock("./UserFilters", () => ({
    UserFilters: ({ onApply }: { onApply: (filters: unknown[]) => void }) => (
        <><button
            onClick={() =>
                onApply([{ key: "banned", condition: "=", value: "0" }])
            }
        >
            应用测试筛选
        </button><button onClick={() => onApply([{ key: "plan_id", condition: "=", value: "7" }])}>应用套餐筛选</button></>
    ),
}));
import { AdminCouponIssue } from "./AdminCouponIssue";
const preview = {
    id: 5,
    previewKey: "b6d1d4b7-4cd8-471b-b1d1-29936403a2c1",
    couponName: "Ten percent",
    discountPercent: 10,
    scope: "all",
    status: "draft",
    matched: 3,
    pending: 2,
    skipped: 1,
    stock: 5,
    issued: 0,
    failed: 0,
    cancelled: 0,
    expiresAt: 1800000000,
    createdAt: 1700000000,
    administratorId: 1,
};
beforeEach(() => {
    vi.clearAllMocks();
    api.request.mockResolvedValue({ data: preview });
});
afterEach(cleanup);
it("requires explicit all-user selection, previews the audience, then confirms the same snapshot only once", async () => {
    const queued = vi.fn();
    render(<AdminCouponIssue onQueued={queued} />);
    fireEvent.change(screen.getByLabelText("优惠券"), {
        target: { value: "7" },
    });
    fireEvent.click(screen.getByText("预览发放范围"));
    await screen.findByRole("alert");
    expect(api.request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("发放范围"), {
        target: { value: "all" },
    });
    fireEvent.click(screen.getByText("预览发放范围"));
    await screen.findByText("发放预览 · Ten percent");
    expect(api.request).toHaveBeenCalledWith("coupon-campaign/preview", {
        coupon_id: 7,
        scope: "all",
        filter: [],
    });
    const confirm = screen.getByText("确认分批发放") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(queued).toHaveBeenCalledOnce());
    expect(
        api.request.mock.calls.filter(
            ([path]) => path === "coupon-campaign/confirm",
        ),
    ).toEqual([
        [
            "coupon-campaign/confirm",
            { preview_key: preview.previewKey, confirmed: true },
        ],
    ]);
});
it("shares user filter payloads and prevents confirmation when stock is insufficient", async () => {
    api.request.mockResolvedValue({ data: { ...preview, stock: 1 } });
    render(<AdminCouponIssue onQueued={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("优惠券"), {
        target: { value: "7" },
    });
    fireEvent.click(screen.getByText("设置用户筛选"));
    fireEvent.click(screen.getByText("应用测试筛选"));
    fireEvent.click(screen.getByText("预览发放范围"));
    await screen.findByText(/库存不足/);
    expect(api.request).toHaveBeenCalledWith("coupon-campaign/preview", {
        coupon_id: 7,
        scope: "filtered",
        filter: [{ key: "banned", condition: "=", value: "0" }],
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
        (screen.getByText("确认分批发放") as HTMLButtonElement).disabled,
    ).toBe(true);
});
it("releases an abandoned preview before allowing changes to its frozen criteria", async () => {
    render(<AdminCouponIssue onQueued={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("优惠券"), {
        target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("发放范围"), {
        target: { value: "all" },
    });
    fireEvent.click(screen.getByText("预览发放范围"));
    await screen.findByText("发放预览 · Ten percent");
    expect(
        (screen.getByLabelText("发放范围") as HTMLSelectElement).closest(
            "fieldset",
        )?.disabled,
    ).toBe(true);
    fireEvent.click(screen.getByText("修改范围"));
    await screen.findByText("可重新设置发放范围。");
    expect(api.request).toHaveBeenCalledWith("coupon-campaign/cancel", {
        id: 5,
    });
    expect(screen.queryByText("发放预览 · Ten percent")).toBeNull();
});
it("shows the plan name in coupon audience summaries while preserving the ID payload", async () => {
    render(<AdminCouponIssue onQueued={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("优惠券"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("设置用户筛选"));
    fireEvent.click(screen.getByText("应用套餐筛选"));
    expect(screen.getByText(/套餐 = Basic/)).toBeTruthy();
    fireEvent.click(screen.getByText("预览发放范围"));
    await screen.findByText("发放预览 · Ten percent");
    expect(api.request).toHaveBeenCalledWith("coupon-campaign/preview", {
        coupon_id: 7, scope: "filtered", filter: [{ key: "plan_id", condition: "=", value: "7" }],
    });
});
