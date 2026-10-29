import { useEffect, useRef, useState } from "react";
import { bytes, money, navigate, type Row } from "../shared/api";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import { PlanDescription } from "../shared/PlanDescription";
import { Empty, State, useData } from "../shared/ui";
import { activePlan } from "../shared/user-experience";
import type { V10WalletCoupon } from "../shared/v10-types";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import {
    billingPeriodMonths,
    billingPeriods,
    periodSavings,
    purchasePeriods,
    subscriptionAction,
    unfinishedOrder,
    usablePurchaseCoupon,
} from "./billing-flow";
import { PendingOrderNotice } from "./PendingOrderNotice";
import { pricingCopy as pc } from "./pricing-copy";
import "./pricing.css";

import { UnifiedCheckout } from "./UnifiedCheckout";
import { PurchaseSteps } from "./PurchaseSteps";
import { PlanResetRule } from "./PurchaseRules";
import { availableCouponIntent, catalogReturnPath, catalogSelection } from "./checkout-navigation";
export function SubscriptionPurchase() {
    const plans = useData<Row[]>("user/plan/fetch");
    const orders = useData<Row[]>("user/order/fetch");
    const sub = useData("user/getSubscribe");
    const [selected, setSelected] = useState<Row | null>(null);
    const [billingPeriod, setBillingPeriod] = useState(() => catalogSelection().period || "month_price");
    const [mobilePlanId, setMobilePlanId] = useState<number | null>(() => catalogSelection().planId || null);
    const [couponIntentId, setCouponIntentId] = useState(() => catalogSelection().couponId);
    const requestedChoice = useRef(catalogSelection());
    const intent = useRef({ id: couponIntentId, handled: false, manual: false });
    const wallet = useData<V10WalletCoupon[]>(couponIntentId ? "user/coupon/wallet" : "");
    const walletRetryIn = useRetryCountdown(wallet.retryAt);
    const walletChecked = !wallet.loading && !wallet.error && Array.isArray(wallet.data);
    const intendedCoupon = walletChecked
        ? wallet.data?.find((coupon) => coupon.id === couponIntentId && availableCouponIntent(coupon))
        : undefined;
    const couponMatches = (plan: Row, period: string) => Boolean(intendedCoupon &&
        usablePurchaseCoupon(intendedCoupon, Number(plan.id), period));
    const pending = unfinishedOrder(orders.data || []);
    const replaceable =
        pending &&
        Number(pending.status) === 0 &&
        !pending.payment_id &&
        purchasePeriods({ [pending.period]: 0 }).length > 0;
    const currentPlan = sub.data?.plan;
    const currentAvailable =
        activePlan(currentPlan, sub.data?.expired_at) &&
        Number(sub.data?.transfer_enable) > 0;
    const visiblePlans = (plans.data || []).filter(
        (plan) => purchasePeriods(plan).length > 0,
    );
    if (
        currentPlan &&
        purchasePeriods(currentPlan).length > 0 &&
        currentAvailable &&
        Number(currentPlan.renew) === 1 &&
        !visiblePlans.some((plan) => Number(plan.id) === Number(currentPlan.id))
    )
        visiblePlans.unshift(currentPlan);
    const cycles = Object.keys(billingPeriods).filter((key) =>
        visiblePlans.some((plan) => purchasePeriods(plan).includes(key)),
    );
    const activePeriod = cycles.includes(billingPeriod)
        ? billingPeriod
        : cycles[0];
    const cyclePlans = visiblePlans.filter((plan) =>
        purchasePeriods(plan).includes(activePeriod),
    ).sort((a, b) => intendedCoupon
        ? Number(couponMatches(b, activePeriod)) - Number(couponMatches(a, activePeriod))
        : 0);
    const couponFitsCatalog = visiblePlans.some((plan) => purchasePeriods(plan).some((period) => couponMatches(plan, period)));
    const couponFitsPeriod = cyclePlans.some((plan) => couponMatches(plan, activePeriod));
    const intentMessage = !couponFitsCatalog
        ? tx("couponIntentUnavailable", { ns: "pricing", defaultValue: "This coupon is unavailable for the plans shown. You can continue without it." })
        : couponFitsPeriod
          ? tx("couponIntentEligible", { ns: "pricing", defaultValue: "Eligible plans are shown first. Your selected coupon will be checked at checkout." })
          : tx("couponIntentDifferentPeriod", { ns: "pricing", defaultValue: "This coupon does not apply to this period. Choose a different period to use it." });
    const mobileActive =
        cyclePlans.find((plan) => Number(plan.id) === mobilePlanId) ||
        cyclePlans.find(
            (plan) =>
                Number(plan.id) ===
                    Number(sub.data?.plan_id || currentPlan?.id) &&
                Number(plan.renew) !== 0,
        ) ||
        cyclePlans.find(
            (plan) =>
                (plan.capacity_limit == null ||
                    Number(plan.capacity_limit) > 0) &&
                !(
                    Number(plan.id) ===
                        Number(sub.data?.plan_id || currentPlan?.id) &&
                    Number(plan.renew) === 0
                ),
        ) ||
        cyclePlans[0];
    useEffect(() => {
        const restore = () => {
            if (location.hash.slice(2).split("?")[0] !== "plan") return;
            const choice = catalogSelection();
            requestedChoice.current = choice;
            if (intent.current.id !== choice.couponId)
                intent.current = { id: choice.couponId, handled: false, manual: false };
            setCouponIntentId(choice.couponId);
            setBillingPeriod(choice.period || "month_price");
            setMobilePlanId(choice.planId || null);
        };
        window.addEventListener("hashchange", restore);
        return () => window.removeEventListener("hashchange", restore);
    }, []);
    useEffect(() => {
        if (!couponIntentId || intent.current.handled || intent.current.manual ||
            !walletChecked || plans.loading || plans.error || !Array.isArray(plans.data) ||
            sub.loading || sub.error) return;
        intent.current.handled = true;
        if (!intendedCoupon) return;
        // Explicit catalog choices, including a checkout return, take precedence
        // over coupon suggestions even when navigation remounts the catalog.
        const choice = requestedChoice.current;
        if ((choice.period && cycles.includes(choice.period)) ||
            (choice.planId && visiblePlans.some((plan) => Number(plan.id) === choice.planId))) return;
        // Locate a usable choice once. Later cycle/plan choices belong to the user.
        for (const period of [billingPeriod, ...cycles.filter((key) => key !== billingPeriod)]) {
            const matching = visiblePlans.filter((plan) => {
                const same = Number(plan.id) === Number(sub.data?.plan_id || currentPlan?.id);
                return purchasePeriods(plan).includes(period) &&
                    usablePurchaseCoupon(intendedCoupon, Number(plan.id), period) &&
                    (plan.capacity_limit == null || Number(plan.capacity_limit) > 0 || same) &&
                    !(same && Number(plan.renew) === 0);
            });
            const match = matching.find((plan) => Number(plan.id) === mobilePlanId) || matching[0];
            if (match) {
                setBillingPeriod(period);
                setMobilePlanId(Number(match.id));
                break;
            }
        }
    }, [couponIntentId, walletChecked, intendedCoupon, plans.data, plans.loading, plans.error, sub.data, sub.loading, sub.error]);
    useEffect(() => {
        if (!activePeriod || !mobileActive || location.hash.slice(2).split("?")[0] !== "plan") return;
        history.replaceState(history.state, "", `#/${catalogReturnPath(mobileActive.id, activePeriod, couponIntentId)}`);
    }, [activePeriod, mobileActive?.id, couponIntentId]);
    if (selected)
        return (
            <UnifiedCheckout
                initialPlan={selected}
                couponIntentId={couponIntentId}
                replaceTradeNo={
                    !selected.resetOnly && replaceable
                        ? pending?.trade_no
                        : undefined
                }
                onBack={(couponId) => {
                    setCouponIntentId(couponId);
                    setSelected(null);
                }}
            />
        );
    return (
        <section className="subscription-catalog">
            <PurchaseSteps step={1} />
            <State {...sub} retry={sub.reload}>
                {null}
            </State>
            <State {...orders} retry={orders.reload}>
                {pending && (
                    <PendingOrderNotice
                        order={pending}
                        reload={orders.reload}
                    />
                )}
            </State>
            <State {...plans} retry={plans.reload}>
                {couponIntentId && wallet.error && (
                    <div className="pricing-guide" role="status">
                        <span>{pc("couponUnavailable")}</span>{" "}
                        <button type="button" disabled={wallet.loading || walletRetryIn > 0} onClick={wallet.reload}>
                            {walletRetryIn > 0 ? pc("retryIn", { seconds: walletRetryIn }) : tx("重试")}
                        </button>
                    </div>
                )}
                {couponIntentId && walletChecked && !plans.loading && !plans.error && (
                    <p className="pricing-guide" role="status">
                        {intentMessage}
                    </p>
                )}
                <div className="pricing-toolbar">
                    <p className="pricing-guide">{pc("catalogHint")}</p>
                    <div
                        className="pricing-cycle"
                        role="group"
                        aria-label={tx("选择订阅周期")}
                    >
                        {cycles.map((key) => (
                            <button
                                key={key}
                                aria-pressed={activePeriod === key}
                                onClick={() => {
                                    intent.current.manual = true;
                                    setBillingPeriod(key);
                                }}
                            >
                                {tx(billingPeriods[key])}
                            </button>
                        ))}
                    </div>
                </div>
                {cyclePlans.length > 1 && (
                    <div
                        className="mobile-plan-picker"
                        role="group"
                        aria-label={tx("选择套餐")}
                    >
                        {cyclePlans.map((plan) => (
                            <button
                                key={plan.id}
                                type="button"
                                aria-label={plan.name}
                                aria-describedby={`pricing-choice-${plan.id}`}
                                aria-pressed={
                                    Number(mobileActive?.id) === Number(plan.id)
                                }
                                aria-controls={`pricing-plan-${plan.id}`}
                                onClick={() => {
                                    intent.current.manual = true;
                                    setMobilePlanId(Number(plan.id));
                                }}
                            >
                                <strong>{plan.name}</strong>
                                <span id={`pricing-choice-${plan.id}`}>
                                    <span className="mobile-plan-price">
                                        <bdi dir="ltr">
                                            {money(
                                                plan[activePeriod],
                                                plan.currency,
                                            )}
                                        </bdi>
                                        {" · "}
                                        {tx(billingPeriods[activePeriod])}
                                    </span>
                                    {plan.capacity_limit != null &&
                                        Number(plan.capacity_limit) <= 0 &&
                                        Number(plan.id) !==
                                            Number(
                                                sub.data?.plan_id ||
                                                    currentPlan?.id,
                                            ) && (
                                            <span className="mobile-plan-status">
                                                {tx("暂时售罄")}
                                            </span>
                                        )}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                <div className="plans pricing-plans">
                    {cyclePlans.length ? (
                        cyclePlans.map((plan) => {
                            const available = purchasePeriods(plan);
                            const displayed = activePeriod;
                            const action = subscriptionAction(plan, sub.data);
                            const savings = periodSavings(plan, displayed);
                            const same =
                                Number(
                                    sub.data?.plan_id || sub.data?.plan?.id,
                                ) === Number(plan.id);
                            const soldOut =
                                plan.capacity_limit != null &&
                                Number(plan.capacity_limit) <= 0 &&
                                !same;
                            const blocked =
                                (Boolean(pending) && !replaceable) ||
                                orders.loading ||
                                Boolean(orders.error) ||
                                sub.loading ||
                                Boolean(sub.error) ||
                                !available.length ||
                                soldOut ||
                                (same && Number(plan.renew) === 0);
                            return (
                                <article
                                    id={`pricing-plan-${plan.id}`}
                                    className={`plan-card ${same && currentAvailable ? "is-current" : ""} ${Number(mobileActive?.id) === Number(plan.id) ? "mobile-active" : ""}`}
                                    key={plan.id}
                                >
                                    <div className="pricing-card-heading">
                                        <h2>{plan.name}</h2>
                                        {same && (
                                            <span
                                                className={`badge ${currentAvailable ? "success" : ""}`}
                                            >
                                                {activePlan(
                                                    plan,
                                                    sub.data?.expired_at,
                                                )
                                                    ? tx("当前套餐")
                                                    : pc("previousPlan")}
                                            </span>
                                        )}
                                    </div>
                                    <dl className="pricing-specs">
                                        {Number.isFinite(
                                            Number(plan.transfer_enable),
                                        ) &&
                                            Number(plan.transfer_enable) >
                                                0 && (
                                                <div>
                                                    <dt>
                                                        {pc("trafficVolume")}
                                                    </dt>
                                                    <dd>
                                                        <bdi dir="ltr">
                                                            {bytes(
                                                                Number(
                                                                    plan.transfer_enable,
                                                                ) * 1073741824,
                                                            )}
                                                        </bdi>
                                                    </dd>
                                                </div>
                                            )}
                                        {Number.isFinite(
                                            Number(plan.device_limit),
                                        ) &&
                                            Number(plan.device_limit) > 0 && (
                                                <div>
                                                    <dt>{e("deviceLimit")}</dt>
                                                    <dd>{plan.device_limit}</dd>
                                                </div>
                                            )}
                                        {Number.isFinite(
                                            Number(plan.speed_limit),
                                        ) &&
                                            Number(plan.speed_limit) > 0 && (
                                                <div>
                                                    <dt>{pc("speedCap")}</dt>
                                                    <dd>
                                                        <bdi dir="ltr">
                                                            {pc("speedValue", {
                                                                value: plan.speed_limit,
                                                            })}
                                                        </bdi>
                                                    </dd>
                                                </div>
                                            )}
                                    </dl>
                                    <PlanResetRule plan={plan} />
                                    <div className="pricing-summary">
                                        <div className="plan-price">
                                            {money(
                                                plan[displayed],
                                                plan.currency,
                                            )}
                                            <small>
                                                {" "}
                                                /{" "}
                                                {displayed === "year_price"
                                                    ? pc("year")
                                                    : displayed ===
                                                        "month_price"
                                                      ? pc("month")
                                                      : tx(
                                                            billingPeriods[
                                                                displayed
                                                            ],
                                                        )}
                                            </small>
                                        </div>
                                        <p className="pricing-total-note">
                                            {pc("total")}
                                        </p>
                                        <div className="pricing-note pricing-meta">
                                            {billingPeriodMonths[displayed] >
                                                1 && (
                                                <span>
                                                    {pc("equivalent", {
                                                        price: money(
                                                            Number(
                                                                plan[displayed],
                                                            ) /
                                                                billingPeriodMonths[
                                                                    displayed
                                                                ],
                                                            plan.currency,
                                                        ),
                                                    })}
                                                </span>
                                            )}
                                            {savings > 0 && (
                                                <span
                                                    className="pricing-saving"
                                                    title={pc("save", {
                                                        percent: savings,
                                                    })}
                                                    aria-label={pc("save", {
                                                        percent: savings,
                                                    })}
                                                >
                                                    {pc("savingBadge", {
                                                        percent: savings,
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="primary"
                                        disabled={blocked}
                                        onClick={() => {
                                            navigate(
                                                `plan/${plan.id}?period=${displayed}${couponIntentId ? `&couponId=${couponIntentId}` : ""}${replaceable ? `&replace=${encodeURIComponent(pending.trade_no)}` : ""}`,
                                            );
                                            setSelected({
                                                ...plan,
                                                initialPeriod: displayed,
                                                purchaseAction: action,
                                            });
                                        }}
                                    >
                                        {soldOut
                                            ? tx("暂时售罄")
                                            : same && Number(plan.renew) === 0
                                              ? tx("暂不支持续费")
                                              : pc(action)}
                                    </button>
                                    <PlanDescription content={plan.content} />
                                </article>
                            );
                        })
                    ) : (
                        <div className="pricing-empty">
                            <Empty text={tx("暂无可购买套餐")} />
                            <div className="pricing-empty-actions">
                                <button type="button" onClick={plans.reload}>
                                    {tx("刷新")}
                                </button>
                                <a href="#/knowledge">{tx("帮助中心")}</a>
                            </div>
                        </div>
                    )}
                </div>
                {visiblePlans.length > 0 && (
                    <p className="pricing-help">
                        <a href="#/knowledge">{tx("帮助中心")}</a>
                        <span>{pc("setupAfterPayment")}</span>
                    </p>
                )}
            </State>
        </section>
    );
}

export { PlanSelection } from "./PlanSelection";
export { PurchaseSteps } from "./PurchaseSteps";
