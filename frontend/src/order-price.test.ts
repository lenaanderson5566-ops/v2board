import { expect, it } from "vitest";
import { orderOriginalAmount } from "./billing-flow";

it("uses historical amounts despite catalog price changes", () => {
    expect(orderOriginalAmount({ total_amount: 3880, balance_amount: 2000, plan: { month_price: 99999 } })).toBe(5880);
});
it("restores discounts and only the used portion of old-plan credit", () => {
    expect(orderOriginalAmount({ total_amount: 0, discount_amount: 1000, surplus_amount: 8000, refund_amount: 3000 })).toBe(6000);
});
it("retains the original quote after cancellation and supports free orders", () => {
    expect(orderOriginalAmount({ status: 2, total_amount: 3880, balance_amount: 2000, handling_amount: 100 })).toBe(5880);
    expect(orderOriginalAmount({ total_amount: 0 })).toBe(0);
});
