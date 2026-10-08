// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ request: vi.fn(), methods: [
    { id: 1, name: "Alipay", handling_fee_fixed: 0 },
    { id: 2, name: "USDT A", category: "crypto", asset: "USDT", network: "tron", network_name: "TRON", handling_fee_fixed: 10 },
    { id: 3, name: "USDT B", category: "crypto", asset: "USDT", network: "bsc", network_name: "BSC", handling_fee_fixed: 100, handling_fee_percent: 5 },
] }));
vi.mock("../shared/api", () => ({ request: mock.request, bytes: String, money: (amount: number) => `CNY ${(Number(amount) / 100).toFixed(2)}`, query: (path: string) => path }));
vi.mock("../shared/i18n", () => ({ tx: (value: string) => value, locale: () => "zh-CN" }));
vi.mock("../shared/ui", () => ({ useData: () => ({ data: mock.methods, loading: false, reload: vi.fn() }), State: ({ children }: any) => children, Modal: ({ children }: any) => children }));
vi.mock("./SubscriptionPurchase", () => ({ PurchaseSteps: () => null }));
vi.mock("./OrderHelp", () => ({ OrderHelp: () => null }));
vi.mock("./OrderReceipt", () => ({ OrderReceipt: () => null }));
vi.mock("../shared/credit-copy", () => ({ c: (value: string) => value, minuteDate: () => "" }));
import { PaymentCheckout } from "./PaymentCheckout";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("recalculates the exact network fee and submits its channel ID", async () => {
    mock.request.mockResolvedValue({ type: 0, data: "https://example.test/qr" });
    render(<PaymentCheckout order={{ status: 0, plan_id: 1, total_amount: 1000, trade_no: "test-order", plan: { name: "Plan" } }} reload={vi.fn()} renderCard={() => null} />);
    await waitFor(() => expect((screen.getByRole("radio", { name: "Alipay" }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /USDT/ }));
    expect((screen.getByRole("button", { name: "确认支付" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /BSC/ }));
    expect(screen.getByText("CNY 11.50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith("user/order/checkout", { trade_no: "test-order", method: 3 }));
    await screen.findByText("正在等待支付确认，请勿重复付款。");
    expect(screen.getByRole("radio", { name: /BSC/ }).closest("fieldset")?.disabled).toBe(true);
});
