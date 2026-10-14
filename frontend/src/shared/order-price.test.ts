import { expect, it } from "vitest";
import { orderOriginalAmount } from "../user/billing-flow";

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

import { purchasePeriods, paymentFee, periodSavings, subscriptionAction } from "../user/billing-flow";
const plan = {
    id: 1,
    name: "Basic",
    month_price: null,
    quarter_price: 900,
    year_price: 3000,
    reset_price: 100,
    renew: 1,
    show: 1,
    transfer_enable: 50,
};

it("preserves quarterly and zero-priced periods and excludes reset from ordinary purchase", () => {
    expect(purchasePeriods({ ...plan, onetime_price: 0 })).toEqual([
        "quarter_price",
        "year_price",
    ]);
    expect(paymentFee(1000, { handling_fee_fixed: 30, handling_fee_percent: 2 })).toBe(50);
    expect(paymentFee(0, { handling_fee_fixed: 30, handling_fee_percent: 2 })).toBe(0);
    expect(
        paymentFee(999, { handling_fee_percent: 2.5, handling_fee_fixed: 1 }),
    ).toBe(26);
});

it("matches purchase wording to backend renewal and switching rules", () => {
    const now = 2000000;
    const active = { plan_id: 1, expired_at: 3000, transfer_enable: 50 };
    expect(subscriptionAction(plan, {}, now)).toBe("subscribe");
    expect(subscriptionAction(plan, active, now)).toBe("renew");
    expect(subscriptionAction({ ...plan, id: 2 }, active, now)).toBe(
        "switchPlan",
    );
    expect(subscriptionAction(plan, { ...active, expired_at: 1000 }, now)).toBe(
        "resubscribe",
    );
    expect(
        subscriptionAction(
            { ...plan, id: 2 },
            { ...active, expired_at: 1000 },
            now,
        ),
    ).toBe("subscribe");
    expect(
        subscriptionAction(
            { ...plan, id: 2 },
            { ...active, expired_at: null },
            now,
        ),
    ).toBe("switchPlan");
    expect(
        subscriptionAction(
            { ...plan, id: 2 },
            { ...active, transfer_enable: 0 },
            now,
        ),
    ).toBe("subscribe");
});

it("calculates real savings without inventing discounts", () => {
    expect(
        periodSavings({ month_price: 5880, year_price: 59976 }, "year_price"),
    ).toBe(15);
    expect(
        periodSavings(
            { month_price: 5880, half_year_price: 33516 },
            "half_year_price",
        ),
    ).toBe(5);
    expect(
        periodSavings({ month_price: 0, year_price: 100 }, "year_price"),
    ).toBe(0);
    expect(periodSavings({ year_price: 100 }, "year_price")).toBe(0);
    expect(
        periodSavings({ month_price: 100, year_price: 1300 }, "year_price"),
    ).toBe(0);
});
