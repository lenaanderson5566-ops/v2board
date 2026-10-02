import type { Row } from "./api";
export const billingPeriods: Record<string, string> = {
    month_price: "月付",
    quarter_price: "季付",
    half_year_price: "半年付",
    year_price: "年付",
    two_year_price: "两年付",
    three_year_price: "三年付",
    onetime_price: "一次性",
    reset_price: "流量重置",
};
export function purchasePeriods(plan: Row): string[] {
    return Object.keys(billingPeriods).filter(
        (key) =>
            key !== "reset_price" &&
            key !== "onetime_price" &&
            plan[key] != null &&
            Number.isFinite(Number(plan[key])) &&
            Number(plan[key]) >= 0,
    );
}
export function paymentFee(amount: number, method?: Row): number {
    if (amount <= 0 || !method) return 0;
    const value =
        amount * (Number(method.handling_fee_percent || 0) / 100) +
        Number(method.handling_fee_fixed || 0);
    return Math.sign(value) * Math.round(Math.abs(value));
}
export function unfinishedOrder(orders: Row[]): Row | undefined {
    return orders.find((order) => [0, 1].includes(Number(order.status)));
}

// Compare configured cycle prices only; checkout remains authoritative.
export function periodSavings(plan: Row, period: string): number {
    const months: Record<string, number> = {
        quarter_price: 3,
        half_year_price: 6,
        year_price: 12,
        two_year_price: 24,
        three_year_price: 36,
    };
    if (
        !months[period] ||
        !purchasePeriods(plan).includes(period) ||
        !purchasePeriods(plan).includes("month_price")
    )
        return 0;
    const baseline = Number(plan.month_price) * months[period];
    if (baseline <= 0) return 0;
    return Math.max(
        0,
        Math.floor((1 - Number(plan[period]) / baseline) * 100 + 1e-9),
    );
}
