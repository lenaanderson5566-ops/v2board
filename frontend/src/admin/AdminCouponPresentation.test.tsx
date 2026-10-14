// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), reload: vi.fn() }));
vi.mock("../shared/api", () => ({
    admin: (path: string) => path,
    request: mocks.request,
}));
vi.mock("../shared/ui", () => ({
    State: ({ children }: any) => children,
    Pager: () => null,
    useData: () => ({
        data: [
            {
                id: 7,
                name: "Base coupon",
                public_claim: 1,
                activity_title: "Base title",
                activity_description: "Base description",
                translations: {
                    "en-US": { name: "English coupon" },
                    "ja-JP": { name: "Japanese coupon" },
                },
            },
        ],
        total: 1,
        reload: mocks.reload,
        loading: false,
        error: "",
    }),
}));
import { AdminCouponPresentation } from "./AdminCouponPresentation";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
function select() {
    render(<AdminCouponPresentation />);
    fireEvent.change(screen.getByRole("combobox", { name: "选择优惠券" }), {
        target: { value: "7" },
    });
}
it("preserves other translations and only sends presentation fields", async () => {
    mocks.request.mockResolvedValue({ data: true });
    select();
    fireEvent.change(screen.getByLabelText("翻译活动标题"), {
        target: { value: "New title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存活动与翻译" }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenCalledWith("coupon-presentation/save", {
        id: 7,
        activity_title: "Base title",
        activity_description: "Base description",
        translations: {
            "en-US": { name: "English coupon", activityTitle: "New title" },
            "ja-JP": { name: "Japanese coupon" },
        },
    });
});
it("clears only the selected language", async () => {
    mocks.request.mockResolvedValue({ data: true });
    select();
    fireEvent.click(screen.getByRole("button", { name: "清空当前语言翻译" }));
    fireEvent.click(screen.getByRole("button", { name: "保存活动与翻译" }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.request.mock.calls[0][1].translations).toEqual({
        "ja-JP": { name: "Japanese coupon" },
    });
});
it("retains a failed draft for retry", async () => {
    mocks.request.mockRejectedValue(new Error("保存失败"));
    select();
    fireEvent.change(screen.getByLabelText("默认活动标题"), {
        target: { value: "Draft title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存活动与翻译" }));
    expect(await screen.findByText("保存失败")).toBeTruthy();
    expect(
        (screen.getByLabelText("默认活动标题") as HTMLInputElement).value,
    ).toBe("Draft title");
    expect(mocks.reload).not.toHaveBeenCalled();
});
