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
const settings = {
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
};
vi.mock("../shared/ui", () => ({
    useData: () => ({
        loading: false,
        error: "",
        reload: api.reload,
        data: settings,
    }),
    State: ({ children }: { children: React.ReactNode }) => children,
}));
import { AdminBillingCurrency } from "./AdminBillingCurrency";
import { useAdminOperation } from "./admin-operation";
beforeEach(() => {
    vi.clearAllMocks();
    api.request.mockResolvedValue({ data: {} });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});
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
    const usd = screen.getByRole("button", { name: "美元（USD）" });
    fireEvent.click(usd);
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
    expect(usd.getAttribute("aria-pressed")).toBe("true");
    expect(usd.closest("form")?.getAttribute("data-unsaved")).toBe("true");
});

it("confirms the default currency change and preserves a separate price draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminBillingCurrency />);
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "保存默认币种" });
    const plan = screen.getByLabelText<HTMLSelectElement>("选择套餐");
    expect(save.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "人民币（CNY）" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(plan, { target: { value: "7" } });
    const price = screen.getByLabelText<HTMLInputElement>("月付（USD）");
    fireEvent.change(price, { target: { value: "6.50" } });

    fireEvent.click(screen.getByRole("button", { name: "美元（USD）" }));
    expect(save.closest("form")?.getAttribute("data-unsaved")).toBe("true");
    fireEvent.click(save);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("从 CNY 改为 USD"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("仅对之后注册的账户生效"));
    expect(api.request).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(save);
    await screen.findByText("新用户默认币种已设为 USD。");
    expect(api.request).toHaveBeenCalledExactlyOnceWith("config/save", { new_user_currency: "USD" });
    expect(api.reload).toHaveBeenCalledOnce();
    expect(save.closest("form")?.hasAttribute("data-unsaved")).toBe(false);
    expect(save.disabled).toBe(true);
    expect(price.value).toBe("6.50");
    expect(price.closest("form")?.getAttribute("data-unsaved")).toBe("true");
    fireEvent.change(plan, { target: { value: "" } });
    expect(plan.value).toBe("7");
    expect(price.value).toBe("6.50");
});

it("shows the server error and keeps the default currency draft for retry", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let reject!: (error: Error) => void;
    api.request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<AdminBillingCurrency />);
    const usd = screen.getByRole("button", { name: "美元（USD）" });
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "保存默认币种" });
    fireEvent.click(usd);
    fireEvent.click(save);
    fireEvent.click(save);
    expect(save.closest('[data-saving="true"]')).toBeTruthy();
    expect(api.request).toHaveBeenCalledOnce();
    expect(screen.getByLabelText<HTMLSelectElement>("选择套餐").disabled).toBe(true);
    reject(new Error("请先为至少一个在售套餐配置美元价格。"));
    expect((await screen.findByRole("alert")).textContent).toBe("请先为至少一个在售套餐配置美元价格。");
    expect(usd.getAttribute("aria-pressed")).toBe("true");
    expect(save.closest("form")?.getAttribute("data-unsaved")).toBe("true");
    expect(api.reload).not.toHaveBeenCalled();
    fireEvent.click(save);
    await screen.findByText("新用户默认币种已设为 USD。");
    expect(api.request).toHaveBeenCalledTimes(2);
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
