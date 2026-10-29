import { bytes, type Row } from "../shared/api";
import { billingPeriodMonths } from "./billing-flow";
import { pricingCopy as pc } from "./pricing-copy";

const resetRules = [
    "ruleResetMonthStart",
    "ruleResetMonthExpiry",
    "ruleNoReset",
    "ruleResetYearStart",
    "ruleResetYearExpiry",
] as const;

function resetDescription(plan: Row): string | undefined {
    const rawQuota = plan.transfer_enable;
    const quota =
        typeof rawQuota === "number" || typeof rawQuota === "string"
            ? Number(rawQuota)
            : NaN;
    if (!Number.isFinite(quota) || quota <= 0) return;
    function knownMethod(value: unknown): number | undefined {
        const method =
            typeof value === "number"
                ? value
                : typeof value === "string" && /^[0-4]$/.test(value)
                  ? Number(value)
                  : NaN;
        return Number.isInteger(method) &&
            method >= 0 &&
            method < resetRules.length
            ? method
            : undefined;
    }
    // New responses resolve inherited site settings; older servers retain the explicit fallback.
    const method =
        knownMethod(plan.effective_reset_traffic_method) ??
        knownMethod(plan.reset_traffic_method);
    const key = method !== undefined ? resetRules[method] : "ruleInherited";
    return pc(key, { amount: bytes(quota * 1073741824) });
}

export function PlanResetRule({ plan }: { plan: Row }) {
    const text = resetDescription(plan);
    return text ? <p className="plan-reset-rule">{text}</p> : null;
}

export function PurchaseRules({ plan, period }: { plan: Row; period: string }) {
    const months = period === "month_price" ? 1 : billingPeriodMonths[period];
    if (plan.resetOnly || !months) return null;
    const traffic = resetDescription(plan);
    const renewable = [1, true, "1"].includes(plan.renew);
    const unavailable = [0, false, "0"].includes(plan.renew);
    return (
        <section className="purchase-rules" aria-label={pc("purchaseRules")}>
            <h4>{pc("purchaseRules")}</h4>
            <ul>
                <li>{pc("ruleValidity", { months })}</li>
                {traffic && <li>{traffic}</li>}
                <li>{pc("ruleFulfillment")}</li>
                {renewable ? (
                    <li>{pc("ruleRenewable")}</li>
                ) : unavailable ? (
                    <li>{pc("ruleNotRenewable")}</li>
                ) : null}
            </ul>
        </section>
    );
}
