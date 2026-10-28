import { useRef, useState, type FormEvent } from "react";
import { money, navigate, request, type Row } from "../shared/api";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import {
    billingPeriods,
    periodSavings,
    purchasePeriods,
    purchaseQuote,
    usablePurchaseCoupon,
} from "./billing-flow";
import { CouponPicker, type WalletCoupon } from "./CouponPicker";
import { pricingCopy as pc } from "./pricing-copy";
import "./pricing.css";
import { useAnalyticsPage } from "./product-analytics";
export function PlanSelection({
    plan,
    close,
    replaceTradeNo,
}: {
    plan: Row;
    close: () => void;
    replaceTradeNo?: string;
}) {
    useAnalyticsPage(plan.resetOnly ? null : "confirmation");
    const available = plan.resetOnly ? ["reset_price"] : purchasePeriods(plan);
    const [period, setPeriod] = useState(
        available.includes(plan.initialPeriod)
            ? plan.initialPeriod
            : available[0] || "",
    );
    const [selection, setCoupon] = useState<WalletCoupon | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
    const coupon =
        selection && usablePurchaseCoupon(selection, Number(plan.id), period)
            ? selection
            : null;
    const quote = purchaseQuote(plan, period, coupon?.discountPercent);
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (submitting.current || !period) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await request<string>("user/order/save", {
                plan_id: plan.id,
                period,
                ...(coupon !== null ? { wallet_coupon_id: coupon.id } : {}),
                ...(replaceTradeNo ? { replace_trade_no: replaceTradeNo } : {}),
            });
            window.dispatchEvent(new Event("data-changed"));
            navigate("order/" + result.data);
            close();
        } catch (problem) {
            const failure = problem as Error & {
                code?: string;
                status?: number;
            };
            setError(
                ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(
                    failure.code || "",
                ) || (failure.status || 0) >= 500
                    ? e("orderUncertain")
                    : failure.message,
            );
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }
    return (
        <form
            className="purchase-selection compact-selection"
            onSubmit={submit}
            aria-busy={busy}
        >
            <fieldset disabled={busy}>
                <div className="purchase-body">
                    <section className="purchase-choices">
                        <h3>
                            {tx(plan.resetOnly ? "流量重置" : "选择订阅周期")}
                        </h3>
                        <div
                            className="period-options"
                            role="group"
                            aria-label={tx("选择订阅周期")}
                        >
                            {available.map((key) => (
                                <label
                                    key={key}
                                    className={period === key ? "selected" : ""}
                                >
                                    <input
                                        type="radio"
                                        name="period"
                                        value={key}
                                        checked={period === key}
                                        onChange={() => {
                                            setPeriod(key);
                                            setCoupon((current) =>
                                                current &&
                                                usablePurchaseCoupon(
                                                    current,
                                                    Number(plan.id),
                                                    key,
                                                )
                                                    ? current
                                                    : null,
                                            );
                                        }}
                                    />
                                    <span className="period-name">
                                        {tx(billingPeriods[key])}
                                    </span>
                                    <strong>
                                        {money(plan[key], plan.currency)}
                                    </strong>
                                    {periodSavings(plan, key) > 0 && (
                                        <small
                                            className="period-saving"
                                            title={pc("save", {
                                                percent: periodSavings(
                                                    plan,
                                                    key,
                                                ),
                                            })}
                                        >
                                            {pc("cycleBadge", {
                                                percent: periodSavings(
                                                    plan,
                                                    key,
                                                ),
                                            })}
                                        </small>
                                    )}
                                </label>
                            ))}
                        </div>
                        <CouponPicker
                            planId={Number(plan.id)}
                            period={period}
                            value={coupon?.id ?? null}
                            amount={quote.amount}
                            currency={plan.currency}
                            onChange={(_id, selected) =>
                                setCoupon(selected ?? null)
                            }
                        />
                    </section>
                    <section
                        className="purchase-breakdown"
                        aria-label={pc("priceDetails")}
                    >
                        <h3>{pc("priceDetails")}</h3>
                        <dl className="checkout-lines" aria-live="polite">
                            {quote.cycleSaving > 0 && (
                                <>
                                    <div>
                                        <dt>
                                            {pc("monthlyBaseline", {
                                                months: quote.months,
                                            })}
                                        </dt>
                                        <dd>
                                            {money(
                                                quote.baseline,
                                                plan.currency,
                                            )}
                                        </dd>
                                    </div>
                                    <div className="discount-line">
                                        <dt>{pc("cycleDiscount")}</dt>
                                        <dd>
                                            −
                                            {money(
                                                quote.cycleSaving,
                                                plan.currency,
                                            )}
                                        </dd>
                                    </div>
                                </>
                            )}
                            <div>
                                <dt>
                                    {tx("套餐价格")} ·{" "}
                                    {tx(billingPeriods[period] || "")}
                                </dt>
                                <dd>{money(quote.amount, plan.currency)}</dd>
                            </div>
                            {coupon && (
                                <div className="discount-line">
                                    <dt>
                                        {tx("优惠金额")}
                                        <small>
                                            {pc("couponBase", {
                                                percent: coupon.discountPercent,
                                                amount: money(
                                                    quote.amount,
                                                    plan.currency,
                                                ),
                                            })}
                                        </small>
                                    </dt>
                                    <dd>
                                        −
                                        {money(
                                            quote.couponSaving,
                                            plan.currency,
                                        )}
                                    </dd>
                                </div>
                            )}
                        </dl>
                        <details className="purchase-fee-note">
                            <summary>{pc("feeDetails")}</summary>
                            <p>{pc("discountOrder")}</p>
                            <p>
                                {tx(
                                    "优惠、旧套餐折抵和余额抵扣以创建后的订单为准。创建订单会预占可用余额，取消订单后返还。",
                                )}
                            </p>
                        </details>
                        {replaceTradeNo && (
                            <p className="muted" role="note">
                                {pc("replaceConfirm")}
                            </p>
                        )}
                        {error && (
                            <div className="alert" role="alert">
                                {error}
                                <a href="#/order">{tx("查看订单记录")}</a>
                            </div>
                        )}
                    </section>
                </div>
                <div className="purchase-footer">
                    <div className="purchase-footer-total" aria-live="polite">
                        <span className="purchase-footer-context">
                            {plan.name} · {tx(billingPeriods[period] || "")}
                        </span>
                        <span>
                            {pc(
                                coupon ? "couponEstimate" : "estimatedSubtotal",
                            )}
                        </span>
                        <strong>{money(quote.subtotal, plan.currency)}</strong>
                        <small>{pc("estimateExclusions")}</small>
                    </div>
                    <button
                        className="primary purchase-primary"
                        disabled={busy || !period}
                    >
                        {tx(busy ? "提交中…" : "创建订单并继续")}
                    </button>
                </div>
            </fieldset>
        </form>
    );
}
