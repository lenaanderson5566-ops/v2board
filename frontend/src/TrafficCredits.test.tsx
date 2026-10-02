// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    render,
    screen,
    fireEvent,
    waitFor,
    act,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    navigate: vi.fn(),
    orders: [] as any[],
    plans: [] as any[],
}));
vi.mock("./api", () => ({
    request: mocks.request,
    navigate: mocks.navigate,
    bytes: (n: number) => `${n} B`,
    money: (n: number) => `$${n / 100}`,
}));
vi.mock("./i18n", () => ({ tx: (s: string) => s }));
vi.mock("./credit-copy", () => ({ c: (s: string) => s }));
vi.mock("./ui", () => ({
    useData: (path: string) => ({
        data: path === "user/credit/fetch" ? mocks.plans : mocks.orders,
        reload: vi.fn(),
        loading: false,
        error: "",
    }),
    State: ({ children }: any) => children,
    Modal: ({ children, title, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>close</button>
            {children}
        </div>
    ),
}));
import { TrafficCredits } from "./TrafficCredits";
beforeEach(() => {
    mocks.request.mockReset();
    mocks.navigate.mockReset();
    mocks.orders = [];
    mocks.plans = [
        { id: 8, name: "Small", bytes: 100, price: 1000 },
        { id: 9, name: "Large", bytes: 500, price: 3000 },
    ];
});
afterEach(cleanup);
it("reveals credit purchase only when requested", () => {
    render(<TrafficCredits balance={123} />);
    expect(screen.getByText("123 B")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(screen.getByRole("combobox")).toBeTruthy();
});
it("uses the selected server price package and blocks duplicate submissions", async () => {
    let done: (v: any) => void = () => {};
    mocks.request.mockImplementation(
        () =>
            new Promise((resolve) => {
                done = resolve;
            }),
    );
    render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "9" } });
    const button = screen.getByRole("button", { name: "checkout" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("user/order/save", {
        plan_id: 9,
        period: "onetime_price",
    });
    await act(async () => done({ data: "credit-order" }));
    expect(mocks.navigate).toHaveBeenCalledWith("order/credit-order");
});
it("routes existing pending orders instead of creating a second charge", () => {
    mocks.orders = [{ status: 0, trade_no: "existing" }];
    render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(
        screen.getByRole("link", { name: "查看" }).getAttribute("href"),
    ).toBe("#/order/existing");
    expect(screen.queryByRole("button", { name: "checkout" })).toBeNull();
});
it("retains the dialog and shows server errors without navigating", async () => {
    mocks.request.mockRejectedValue(new Error("Sold out"));
    render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    fireEvent.click(screen.getByRole("button", { name: "checkout" }));
    await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe("Sold out"),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
});
it("handles an empty catalog without offering a checkout", () => {
    mocks.plans = [];
    render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(screen.getByText("empty")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "checkout" })).toBeNull();
});

it("uses a text purchase action only when requested by billing", () => {
    const { rerender } = render(<TrafficCredits balance={20} purchaseLabel />);
    expect(screen.getByRole("button", { name: "buyMore" }).textContent).toBe("buyMore");
    rerender(<TrafficCredits balance={20} />);
    expect(screen.getByRole("button", { name: "buy" }).textContent).toBe("");
});
