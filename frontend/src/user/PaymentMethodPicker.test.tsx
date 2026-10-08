// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../shared/i18n", () => ({ tx: (value: string) => value }));
import { PaymentMethodPicker, paymentGroups, paymentIconUrl } from "./PaymentMethodPicker";
const methods = [
    { id: 1, name: "Alipay" },
    { id: 2, category: "crypto", asset: "USDT", network: "tron", network_name: "TRON (TRC20)", name: "Channel A" },
    { id: 3, category: "crypto", asset: "USDT", network: "bsc", network_name: "BNB Smart Chain (BEP20)", name: "Channel B" },
    { id: 4, category: "crypto", asset: "BTC", network: "bitcoin", network_name: "Bitcoin", name: "Channel C" },
];
afterEach(cleanup);
it("keeps legacy methods separate and groups crypto channels without losing IDs", () => {
    expect(paymentGroups(methods).map(group => group.methods.map(item => item.id))).toEqual([[1], [2, 3], [4]]);
});
it("requires a network for a multi-network asset and selects the exact channel", () => {
    const select = vi.fn();
    render(<PaymentMethodPicker methods={methods} selected={1} disabled={false} onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: /USDT/ }));
    expect(select).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("radio", { name: /BNB Smart Chain/ }));
    expect(select).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: /BTC/ }));
    expect(select).toHaveBeenLastCalledWith(4);
});
it("restores the selected network and disables changes while payment is pending", () => {
    render(<PaymentMethodPicker methods={methods} selected={2} disabled={true} onSelect={vi.fn()} />);
    expect((screen.getByRole("radio", { name: /TRON/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /USDT/ }).closest("fieldset")?.disabled).toBe(true);
});
it("resolves local PNG and network SVG assets against a separate API host", () => {
    window.V2BOARD = { apiBaseUrl: "https://api.example.test" } as any;
    expect(paymentIconUrl("/payment-icons/alipay-blue.png")).toBe("https://api.example.test/payment-icons/alipay-blue.png");
    expect(paymentIconUrl("/payment-icons/crypto-trx.svg")).toBe("https://api.example.test/payment-icons/crypto-trx.svg");
    expect(paymentIconUrl("https://images.example.test/custom.png")).toBe("https://images.example.test/custom.png");
});
