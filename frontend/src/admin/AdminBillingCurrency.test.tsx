// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    act,
    renderHook,
} from "@testing-library/react";
const api = vi.hoisted(() => ({ request: vi.fn(), reload: vi.fn() }));
vi.mock("../shared/api", () => ({
    admin: (path: string) => path,
    request: api.request,
    money: (value: number, currency: string) => `${currency} ${value / 100}`,
}));
vi.mock("../shared/timezone", () => ({ formatInstant: () => "2026-10-14" }));
vi.mock("../shared/ui", () => ({
    useData: () => ({
        loading: false,
        error: "",
        reload: api.reload,
        data: {
            default_currency: "CNY",
            paid_totals: [{ currency: "CNY", amount: 32800 }],
            rate: {
                usd_cny_micros: 7250000,
                quoted_at: 100,
                fetched_at: 100,
                last_error: null,
            },
            plans: [
                {
                    id: 7,
                    name: "Existing plan",
                    usd_prices: { month_price: 500 },
                },
            ],
        },
    }),
    State: ({ children }: { children: React.ReactNode }) => children,
}));
import { AdminBillingCurrency } from "./AdminBillingCurrency";
import { useAdminOperation } from "./admin-operation";
beforeEach(() => {
    vi.clearAllMocks();
    api.request.mockResolvedValue({ data: {} });
});
afterEach(cleanup);
it("does not restore a stale notice after the view clears an in-flight operation", async () => {
    let resolve!: (message: string) => void;
    const {result}=renderHook(()=>useAdminOperation());
    let completion!: Promise<void>;
    act(()=>{completion=result.current.run(()=>new Promise(done=>{resolve=done;}));});
    act(()=>result.current.clear());
    await act(async()=>{resolve("Previous selection saved");await completion;});
    expect(result.current.notice).toBeNull();
    expect(result.current.busy).toBe(false);
    await act(async()=>{await result.current.run(async()=>"Current selection saved");});
    expect(result.current.notice?.message).toBe("Current selection saved");
});

it("saves only independent USD prices, preserving cents, zero and unavailable periods", async () => {
    render(<AdminBillingCurrency />);
    fireEvent.change(screen.getByLabelText("选择套餐"), {
        target: { value: "7" },
    });
    expect(
        (screen.getByLabelText("月付（USD）") as HTMLInputElement).value,
    ).toBe("5");
    fireEvent.change(screen.getByLabelText("月付（USD）"), {
        target: { value: "0.29" },
    });
    fireEvent.change(screen.getByLabelText("年付（USD）"), {
        target: { value: "0" },
    });
    fireEvent.click(screen.getByText("保存美元价格"));
    await screen.findByText("美元价格已保存。");
    expect(api.request).toHaveBeenCalledWith("billing-currency/prices", {
        plan_id: 7,
        prices: {
            month_price: 29,
            quarter_price: null,
            half_year_price: null,
            year_price: 0,
            two_year_price: null,
            three_year_price: null,
            onetime_price: null,
            reset_price: null,
        },
    });
    expect(api.reload).toHaveBeenCalledOnce();
});
it("retains the draft on failure and blocks rapid duplicate saves", async () => {
    let reject!: (error: Error) => void;
    api.request.mockImplementation(
        () =>
            new Promise((_, failure) => {
                reject = failure;
            }),
    );
    render(<AdminBillingCurrency />);
    fireEvent.change(screen.getByLabelText("选择套餐"), {
        target: { value: "7" },
    });
    const button = screen.getByText("保存美元价格");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.request).toHaveBeenCalledOnce();
    reject(new Error("Network unavailable"));
    await screen.findByRole("alert");
    await waitFor(() =>
        expect(
            (screen.getByText("保存美元价格") as HTMLButtonElement).disabled,
        ).toBe(false),
    );
    expect(
        (screen.getByLabelText("月付（USD）") as HTMLInputElement).value,
    ).toBe("5");
    expect(api.reload).not.toHaveBeenCalled();
});
