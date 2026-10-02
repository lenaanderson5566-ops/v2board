import { useState, useRef, type FormEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { useData, State, Empty, Modal } from "./ui";
import { request, money, navigate, type Row } from "./api";
import { tx } from "./i18n";
import { PlanDescription } from "./PlanDescription";
import { activePlan } from "./user-experience";
import {
    billingPeriods,
    purchasePeriods,
    unfinishedOrder,
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
    const pending = unfinishedOrder(orders.data || []);
    const currentPlan = sub.data?.plan;
    const currentAvailable =
        activePlan(currentPlan, sub.data?.expired_at) &&
        Number(sub.data?.transfer_enable) > 0;
    const visiblePlans = [...(plans.data || [])];
    if (
        currentPlan &&
        currentAvailable &&
        Number(currentPlan.renew) === 1 &&
        !visiblePlans.some((plan) => Number(plan.id) === Number(currentPlan.id))
    )
        visiblePlans.unshift(currentPlan);
    return (
        <>
            <PurchaseSteps step={1} />
            <div className="purchase-intro">
                <p className="muted">
                    {tx("先选择适合的套餐，再确认费用和支付方式。")}
                </p>
                <a href="#/order">{tx("账单")}</a>
            </div>
            <State {...orders} retry={orders.reload}>
                {pending && (
                    <div className="pending-order" role="status">
                        <div>
                            <strong>
                                {tx(
                                    Number(pending.status) === 1
                                        ? "你的订单正在开通"
                                        : "你有一笔待支付订单",
                                )}
                            </strong>
                            <p>
                                {pending.plan?.name || tx("账户充值")} ·{" "}
                                {money(pending.total_amount)}
                            </p>
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
                <div className="plans">
                    {visiblePlans.length ? (
                        visiblePlans.map((plan) => {
                            const available = purchasePeriods(plan);
                            const same =
                                Number(
                                    sub.data?.plan_id || sub.data?.plan?.id,
                                ) === Number(plan.id);
                            const soldOut =
                                plan.capacity_limit != null &&
                                Number(plan.capacity_limit) <= 0 &&
                                !same;
                            const blocked =
                                Boolean(pending) ||
                                orders.loading ||
                                Boolean(orders.error) ||
                                !available.length ||
                                soldOut ||
                                (same && Number(plan.renew) === 0);
                            return (
                                <article className="plan-card" key={plan.id}>
                                    {same && (
                                        <span className="badge">
                                            {tx("当前套餐")}
                                        </span>
                                    )}
                                    <h2>{plan.name}</h2>
                                    <div className="plan-price">
                                        {available.length
                                            ? money(plan[available[0]])
                                            : "—"}
                                        <small>
                                            {available.length
                                                ? ` / ${tx(billingPeriods[available[0]])}`
                                                : ""}
                                        </small>
                                    </div>
                                    <div className="plan-feature">
                                        {plan.transfer_enable} {tx("GB 流量")}
                                    </div>
                                    <div className="plan-feature">
                                        {plan.speed_limit
                                            ? tx("{{value0}} Mbps 速率", {
                                                  value0: plan.speed_limit,
                                              })
                                            : tx("不限速")}
                                    </div>
                                    <div className="plan-feature">
                                        {plan.device_limit
                                            ? tx("{{count}} 台设备", {
                                                  count: plan.device_limit,
                                              })
                                            : tx("不限设备数")}
                                    </div>
                                    <PlanDescription content={plan.content} />
                                    <button
                                        className="primary"
                                        disabled={blocked}
                                        onClick={() => setSelected(plan)}
                                    >
                                        {tx(
                                            soldOut
                                                ? "暂时售罄"
                                                : same &&
                                                    Number(plan.renew) === 0
                                                  ? "暂不支持续费"
                                                  : "选择套餐",
                                        )}
                                        <ArrowUpRight
                                            size={16}
                                            aria-hidden="true"
                                        />
                                    </button>
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
                    title={tx("购买 {{value0}}", { value0: selected.name })}
                    close={() => setSelected(null)}
                >
                    <PlanSelection
                        plan={selected}
                        close={() => setSelected(null)}
                    />
                </Modal>
            )}
        </>
    );
}
function PlanSelection({ plan, close }: { plan: Row; close: () => void }) {
    const available = plan.resetOnly ? ["reset_price"] : purchasePeriods(plan);
    const [period, setPeriod] = useState(available[0] || "");
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
            });
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
        <form className="purchase-selection" onSubmit={submit} aria-busy={busy}>
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
                            <span>{tx(billingPeriods[key])}</span>
                            <strong>{money(plan[key])}</strong>
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
                <p className="muted">
                    {tx(
                        "优惠、旧套餐折抵和余额抵扣以创建后的订单为准。创建订单会预占可用余额，取消订单后返还。",
                    )}
                </p>
                {error && (
                    <div className="alert" role="alert">
                        {error}
                        <a href="#/order">{tx("查看订单记录")}</a>
                    </div>
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
