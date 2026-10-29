import { bytes, type Row } from "../shared/api";
import { billingPeriodMonths } from "./billing-flow";
import { pricingCopy as pc } from "./pricing-copy";
import { tx } from "../shared/i18n";

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

export function PurchaseRules({ plan, period, orderType }: { plan: Row; period: string; orderType?: number }) {
    const months = period === "month_price" ? 1 : billingPeriodMonths[period];
    if (plan.resetOnly || !months) return null;
    const traffic = resetDescription(plan);
    const renewable = [1, true, "1"].includes(plan.renew);
    const unavailable = [0, false, "0"].includes(plan.renew);
    const action = orderType === 2 ? "renew" : orderType === 3 ? "switchPlan"
        : orderType === 1 ? "subscribe" : plan.purchaseAction;
    const impact = action === "renew" ? tx("impactRenew", { ns: "pricing", defaultValue: "Renew this plan for the selected term. Renewal and data reset are separate; used data resets only when the service's renewal or reset rules apply." })
        : action === "switchPlan" ? tx("impactSwitch", { ns: "pricing", defaultValue: "Switching replaces your current plan and starts the selected term after processing. Previous-plan credit and any returned balance are shown in the price breakdown; unused plan data is not added to the new allowance." })
        : action === "resubscribe" ? tx("impactResubscribe", { ns: "pricing", defaultValue: "Reactivate this plan for the selected term. Access and plan allowance are updated after payment is confirmed and processed." })
        : action === "subscribe" ? tx("impactSubscribe", { ns: "pricing", defaultValue: "Activate the selected plan and term after payment is confirmed and processed." }) : undefined;
    return (
        <section className="purchase-rules" aria-label={pc("purchaseRules")}>
            <h4>{pc("purchaseRules")}</h4>
            {impact && <p className="purchase-impact">{impact}</p>}
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
