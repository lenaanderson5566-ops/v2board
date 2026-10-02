import { useState, useRef, type FormEvent } from "react";
import { pricingCopy as pc } from "./pricing-copy";
import "./pricing.css";
import { useData, State, Empty, Modal } from "./ui";
import { request, money, navigate, type Row } from "./api";
import { tx } from "./i18n";
import { PlanDescription } from "./PlanDescription";
import { activePlan } from "./user-experience";
import {
    billingPeriods,
    purchasePeriods,
    unfinishedOrder,
    periodSavings,
    subscriptionAction,
} from "./billing-flow";

export function PurchaseSteps({ step }: { step: number }) {
    return (
        <ol className="purchase-steps" aria-label={tx("订阅流程")}>
            {["选择套餐", "确认与支付", "开通完成"].map((label, index) => (
                <li
                    key={label}
                    className={
                        step === index + 1
                            ? "current"
                            : step > index + 1
                              ? "complete"
                              : ""
                    }
                    aria-current={step === index + 1 ? "step" : undefined}
                >
                    <span>{index + 1}</span>
                    {tx(label)}
                </li>
            ))}
        </ol>
    );
}
export function SubscriptionPurchase() {
    const plans = useData<Row[]>("user/plan/fetch");
    const orders = useData<Row[]>("user/order/fetch");
    const sub = useData("user/getSubscribe");
    const [selected, setSelected] = useState<Row | null>(null);
    const [billingPeriod, setBillingPeriod] = useState("month_price");
    const [mobilePlanId, setMobilePlanId] = useState<number | null>(null);
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
    const mobileActive =
        visiblePlans.find((plan) => Number(plan.id) === mobilePlanId) ||
        visiblePlans.find(
            (plan) =>
                Number(plan.id) ===
                Number(sub.data?.plan_id || currentPlan?.id),
        ) ||
        visiblePlans[0];
    return (
        <section className="subscription-catalog">
            <State {...orders} retry={orders.reload}>
                {pending && (
                    <div className="pending-order" role="status">
                        <div className="pending-order-summary">
                            <span>
                                {tx(
                                    Number(pending.status) === 1
                                        ? "你的订单正在开通"
                                        : "待支付",
                                )}
                            </span>
                            <strong>
                                {pending.plan?.name || tx("账户充值")}
                            </strong>
                            <span className="pending-order-amount">
                                {money(pending.total_amount)}
                            </span>
                        </div>
                        <a
                            className="button primary"
                            href={`#/order/${pending.trade_no}`}
                        >
                            {tx(
                                Number(pending.status) === 1
                                    ? "查看开通进度"
                                    : "继续支付",
                            )}
                        </a>
                    </div>
                )}
            </State>
            <State {...plans} retry={plans.reload}>
                {currentAvailable && currentPlan?.reset_price != null && (
                    <div className="pending-order">
                        <div>
                            <strong>
                                {tx("当前套餐")} · {currentPlan.name}
                            </strong>
                            <p>{tx("重置流量不会延长订阅有效期。")}</p>
                        </div>
                        <button
                            disabled={
                                Boolean(pending) ||
                                orders.loading ||
                                Boolean(orders.error)
                            }
                            onClick={() =>
                                setSelected({ ...currentPlan, resetOnly: true })
                            }
                        >
                            {tx("流量重置")} · {money(currentPlan.reset_price)}
                        </button>
                    </div>
                )}
                <div className="pricing-toolbar">
                    <div
                        className="pricing-cycle"
                        role="group"
                        aria-label={tx("选择订阅周期")}
                    >
                        {["month_price", "year_price"].map((key) => (
                            <button
                                key={key}
                                aria-pressed={billingPeriod === key}
                                onClick={() => setBillingPeriod(key)}
                            >
                                {tx(billingPeriods[key])}
                            </button>
                        ))}
                    </div>
                </div>
                <div
                    className="mobile-plan-picker"
                    role="group"
                    aria-label={tx("选择套餐")}
                >
                    {visiblePlans.map((plan) => (
                        <button
                            key={plan.id}
                            type="button"
                            aria-pressed={
                                Number(mobileActive?.id) === Number(plan.id)
                            }
                            aria-controls={`pricing-plan-${plan.id}`}
                            onClick={() => setMobilePlanId(Number(plan.id))}
                        >
                            {plan.name}
                        </button>
                    ))}
                </div>
                <div className="plans pricing-plans">
                    {visiblePlans.length ? (
                        visiblePlans.map((plan) => {
                            const available = purchasePeriods(plan);
                            const displayed = available.includes(billingPeriod)
                                ? billingPeriod
                                : available[0];
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
                                !available.length ||
                                soldOut ||
                                (same && Number(plan.renew) === 0);
                            return (
                                <article
                                    id={`pricing-plan-${plan.id}`}
                                    className={`plan-card ${Number(mobileActive?.id) === Number(plan.id) ? "mobile-active" : ""}`}
                                    key={plan.id}
                                >
                                    <div className="pricing-card-heading">
                                        <h2>{plan.name}</h2>
                                        {same && (
                                            <span className="badge">
                                                {activePlan(
                                                    plan,
                                                    sub.data?.expired_at,
                                                )
                                                    ? tx("当前套餐")
                                                    : pc("previousPlan")}
                                            </span>
                                        )}
                                    </div>
                                    <div className="pricing-summary">
                                        <div className="plan-price">
                                            {money(plan[displayed])}
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
                                        <div className="pricing-note pricing-meta">
                                            {displayed === "year_price" && (
                                                <span>
                                                    {pc("equivalent", {
                                                        price: money(
                                                            Number(
                                                                plan[displayed],
                                                            ) / 12,
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
                                            {displayed !== billingPeriod && (
                                                <span>
                                                    {pc("fallback", {
                                                        period: tx(
                                                            billingPeriods[
                                                                displayed
                                                            ],
                                                        ),
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="primary"
                                        disabled={blocked}
                                        onClick={() =>
                                            setSelected({
                                                ...plan,
                                                initialPeriod: displayed,
                                                purchaseAction: action,
                                            })
                                        }
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
                        <Empty text={tx("暂无可购买套餐")} />
                    )}
                </div>
            </State>
            {selected && (
                <Modal
                    title={
                        selected.resetOnly
                            ? tx("购买 {{value0}}", { value0: selected.name })
                            : pc("actionTitle", {
                                  action: pc(selected.purchaseAction),
                                  plan: selected.name,
                              })
                    }
                    close={() => setSelected(null)}
                >
                    <PlanSelection
                        plan={selected}
                        replaceTradeNo={
                            !selected.resetOnly && replaceable
                                ? pending?.trade_no
                                : undefined
                        }
                        close={() => setSelected(null)}
                    />
                </Modal>
            )}
        </section>
    );
}
function PlanSelection({
    plan,
    close,
    replaceTradeNo,
}: {
    plan: Row;
    close: () => void;
    replaceTradeNo?: string;
}) {
    const available = plan.resetOnly ? ["reset_price"] : purchasePeriods(plan);
    const [period, setPeriod] = useState(
        available.includes(plan.initialPeriod)
            ? plan.initialPeriod
            : available[0] || "",
    );
    const [coupon, setCoupon] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
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
                ...(coupon.trim() ? { coupon_code: coupon.trim() } : {}),
                ...(replaceTradeNo ? { replace_trade_no: replaceTradeNo } : {}),
            });
            window.dispatchEvent(new Event("data-changed"));
            navigate("order/" + result.data);
            close();
        } catch (problem) {
            setError((problem as Error).message);
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
                <legend>{tx("选择订阅周期")}</legend>
                <div className="period-options">
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
                                onChange={() => setPeriod(key)}
                            />
                            <span className="period-name">
                                {tx(billingPeriods[key])}
                            </span>
                            <strong>{money(plan[key])}</strong>
                            {periodSavings(plan, key) > 0 && (
                                <small
                                    className="period-saving"
                                    title={pc("save", {
                                        percent: periodSavings(plan, key),
                                    })}
                                >
                                    {pc("savingBadge", {
                                        percent: periodSavings(plan, key),
                                    })}
                                </small>
                            )}
                        </label>
                    ))}
                </div>
                <details className="coupon-disclosure">
                    <summary>{tx("使用优惠码")}</summary>
                    <label>
                        {tx("优惠码（可选）")}
                        <input
                            value={coupon}
                            onChange={(event) => setCoupon(event.target.value)}
                            autoComplete="off"
                        />
                    </label>
                </details>
                <dl className="checkout-lines">
                    <div>
                        <dt>{tx("套餐价格")}</dt>
                        <dd>{money(plan[period])}</dd>
                    </div>
                </dl>
                <details className="purchase-fee-note">
                    <summary>{pc("feeDetails")}</summary>
                    <p className="muted">
                        {tx(
                            "优惠、旧套餐折抵和余额抵扣以创建后的订单为准。创建订单会预占可用余额，取消订单后返还。",
                        )}
                    </p>
                </details>
                {error && (
                    <div className="alert" role="alert">
                        {error}
                        <a href="#/order">{tx("查看订单记录")}</a>
                    </div>
                )}
                {replaceTradeNo && (
                    <p className="muted" role="note">
                        {pc("replaceConfirm")}
                    </p>
                )}
                <button
                    className="primary purchase-primary"
                    disabled={busy || !period}
                >
                    {tx(busy ? "提交中…" : "创建订单并继续")}
                </button>
            </fieldset>
        </form>
    );
}
