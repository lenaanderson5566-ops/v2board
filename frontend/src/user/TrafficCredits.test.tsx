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
    boot: { creditAccessPolicy: false },
    request: vi.fn(),
    navigate: vi.fn(),
    orders: [] as any[],
    plans: [] as any[],
    catalogState: {} as any,
    orderState: {} as any,
    stateProps: {} as any,
}));
vi.mock("../shared/api", () => ({
    boot: mocks.boot,
    request: mocks.request,
    navigate: mocks.navigate,
    bytes: (n: number) => `${n} B`,
    money: (n: number) => `$${n / 100}`,
}));
vi.mock("../shared/i18n", () => ({ tx: (s: string) => s }));
vi.mock("../shared/credit-copy", () => ({ c: (s: string, args?: { amount?: string }) => args?.amount ? `${args.amount} credits` : s }));
vi.mock("../shared/ui", () => ({
    useData: (path: string) => ({
        data: path === "user/credit/fetch" ? mocks.plans : mocks.orders,
        reload: vi.fn(),
        loading: false,
        error: "",
        ...(path === "user/credit/fetch" ? mocks.catalogState : mocks.orderState),
    }),
    State: (props: any) => { mocks.stateProps = props; return props.children; },
    Modal: ({ children, title, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>close</button>
            {children}
        </div>
    ),
}));
import { TrafficCredits } from "./TrafficCredits";
beforeEach(() => {
    mocks.boot.creditAccessPolicy = false;
    mocks.request.mockReset();
    mocks.navigate.mockReset();
    mocks.orders = [];
    mocks.catalogState = {};
    mocks.orderState = {};
    mocks.stateProps = {};
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
        screen.getByRole("link", { name: "继续支付" }).getAttribute("href"),
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

it("explains subscription-dependent node access when configured", () => {
    mocks.boot.creditAccessPolicy = true;
    render(<TrafficCredits />);
    expect(screen.getByText("accessHelp")).toBeTruthy();
    expect(screen.queryByText("help")).toBeNull();
});

it("formats package names by capacity instead of administrative plan names", () => {
    render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(screen.getByRole("option", { name: "100 B credits — $10" })).toBeTruthy();
    expect(screen.queryByText(/Small|Large/)).toBeNull();
});
it("retains the package choice while rechecking availability and requires a successful check before purchase", async () => {
    mocks.request.mockResolvedValue({data:"checked-order"});
    const view = render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", {name:"buy"}));
    fireEvent.change(screen.getByRole("combobox"), {target:{value:"9"}});
    mocks.orderState = {loading:true};
    view.rerender(<TrafficCredits />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("9");
    expect((screen.getByRole("button", {name:"checkout"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", {name:"checkout"}));
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.orderState = {};
    view.rerender(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", {name:"checkout"}));
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("user/order/save", {plan_id:9,period:"onetime_price"}));
});
it.each(["catalog", "orders"])("blocks stale choices after a failed %s refresh and exposes the combined cooldown", (source) => {
    const view=render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", {name:"buy"}));
    const failed={error:"Limited",retryAt:Date.now()+5000};
    if(source === "catalog") mocks.catalogState=failed;
    else mocks.orderState=failed;
    view.rerender(<TrafficCredits />);
    expect(mocks.stateProps.retryAt).toBe(failed.retryAt);
    expect(mocks.stateProps.error).toBe("Limited");
    expect((screen.getByRole("button", {name:"checkout"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", {name:"checkout"}));
    expect(mocks.request).not.toHaveBeenCalled();
});
it("does not purchase until the existing-order lookup is available", () => {
    mocks.orderState={data:null};
    render(<TrafficCredits />);
    fireEvent.click(screen.getByRole("button", {name:"buy"}));
    expect((screen.getByRole("button", {name:"checkout"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", {name:"checkout"}));
    expect(mocks.request).not.toHaveBeenCalled();
});
