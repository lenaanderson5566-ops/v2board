import type { Row } from "../shared/api";

export type PlanView = "periodic" | "credits";

export const periodicPlanPrices = {
    month_price: "月付",
    quarter_price: "季付",
    half_year_price: "半年付",
    year_price: "年付",
    two_year_price: "两年付",
    three_year_price: "三年付",
};

const hasPrice = (plan: Row, key: string) =>
    plan[key] != null || plan.usd_prices?.[key] != null;

const hasPeriodicPrice = (plan: Row) =>
    Object.keys(periodicPlanPrices).some((key) => hasPrice(plan, key));

export function planInView(plan: Row, view: PlanView): boolean {
    const credit = hasPrice(plan, "onetime_price");
    return view === "credits" ? credit : !credit || hasPeriodicPrice(plan);
}

export function isMixedPlan(plan: Row): boolean {
    return hasPrice(plan, "onetime_price") && hasPeriodicPrice(plan);
}

export function validateCreditPlan(values: Row): string | undefined {
    const quota = Number(values.transfer_enable);
    if (!Number.isFinite(quota) || quota <= 0) return "流量额度必须大于 0。";
}
