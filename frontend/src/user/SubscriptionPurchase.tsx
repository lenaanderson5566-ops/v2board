import { useState } from "react";
import { bytes, money, type Row } from "../shared/api";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import { PlanDescription } from "../shared/PlanDescription";
import { Empty, Modal, State, useData } from "../shared/ui";
import { activePlan } from "../shared/user-experience";
import {
    billingPeriodMonths,
    billingPeriods,
    periodSavings,
    purchasePeriods,
    subscriptionAction,
    unfinishedOrder,
} from "./billing-flow";
import { PendingOrderNotice } from "./PendingOrderNotice";
import { pricingCopy as pc } from "./pricing-copy";
import "./pricing.css";

import { PlanSelection } from "./PlanSelection";
import { PurchaseSteps } from "./PurchaseSteps";
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
    const cycles = Object.keys(billingPeriods).filter((key) =>
        visiblePlans.some((plan) => purchasePeriods(plan).includes(key)),
    );
    const activePeriod = cycles.includes(billingPeriod)
        ? billingPeriod
        : cycles[0];
    const cyclePlans = visiblePlans.filter((plan) =>
        purchasePeriods(plan).includes(activePeriod),
    );
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
                    {cyclePlans.map((plan) => (
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
                {visiblePlans.length > 0 && (
                    <p className="pricing-help">
                        <a href="#/knowledge">{tx("帮助中心")}</a>
                        <span>{pc("setupAfterPayment")}</span>
                    </p>
                )}
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

export { PlanSelection } from "./PlanSelection";
export { PurchaseSteps } from "./PurchaseSteps";
