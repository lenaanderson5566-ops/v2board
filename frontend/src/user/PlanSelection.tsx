import { useEffect, useRef, useState, type FormEvent } from "react";
import { bytes, money, navigate, request, type Row } from "../shared/api";
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
import { PaymentMethodPicker } from "./PaymentMethodPicker";
import { useCheckoutQuote } from "./useCheckoutQuote";
import type { InitialPayment } from "./PaymentCheckout";
import { useAnalyticsPage } from "./product-analytics";
export function PlanSelection({
    plan,
    close,
    replaceTradeNo,
    unified = false,
    onOrderCreated,
}: {
    unified?: boolean;
    onOrderCreated?: (orderNumber: string, payment: InitialPayment) => void;
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
    const [methodId, setMethodId] = useState(0);
    const manualPaymentSelection = useRef(false);
    const [paymentMethods, setPaymentMethods] = useState<Row[]>([]);
    const [uncertain, setUncertain] = useState(false);
    const submitted = useRef<
        { body: Row; payment: InitialPayment } | undefined
    >(undefined);
    const coupon =
        selection && usablePurchaseCoupon(selection, Number(plan.id), period)
            ? selection
            : null;
    const quote = purchaseQuote(plan, period, coupon?.discountPercent);
    const preview = useCheckoutQuote(unified && !uncertain, {
        plan_id: Number(plan.id),
        period,
        ...(coupon ? { wallet_coupon_id: coupon.id } : {}),
        ...(replaceTradeNo ? { replace_trade_no: replaceTradeNo } : {}),
        quote_method: methodId,
    });
    const serverQuote = preview.data;
    useEffect(() => {
        if (serverQuote) setPaymentMethods(serverQuote.methods || []);
    }, [serverQuote]);
    useEffect(() => {
        if (
            !unified ||
            methodId ||
            manualPaymentSelection.current ||
            !serverQuote ||
            Number(serverQuote.total_amount) <= 0
        )
            return;
        const recommended = serverQuote.methods?.find(
            (method: Row) => method.category !== "crypto",
        );
        if (recommended) setMethodId(Number(recommended.id));
    }, [unified, methodId, serverQuote]);
    useEffect(() => {
        if (unified && preview.error && methodId) {
            setError(preview.error);
            manualPaymentSelection.current = false;
            setMethodId(0);
        }
    }, [unified, preview.error, methodId]);
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (
            submitting.current ||
            !period ||
            (unified &&
                !uncertain &&
                (!serverQuote?.quote_token ||
                    preview.loading ||
                    preview.expired))
        )
            return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
            const body: Row = {
                plan_id: plan.id,
                period,
                ...(coupon !== null ? { wallet_coupon_id: coupon.id } : {}),
                ...(replaceTradeNo ? { replace_trade_no: replaceTradeNo } : {}),
            };
            if (unified) {
                if (!uncertain || !submitted.current)
                    submitted.current = {
                        body: {
                            ...body,
                            checkout_quote: serverQuote!.quote_token,
                            checkout_request_key: crypto.randomUUID(),
                            quote_method: methodId,
                        },
                        payment: {
                            methodId: Number(serverQuote!.payment_method_id),
                            amount: Number(serverQuote!.payment_amount),
                            currency: String(serverQuote!.payment_currency),
                            requestKey: crypto.randomUUID(),
                        },
                    };
                const result = await request<string>(
                    "user/order/save",
                    submitted.current.body,
                );
                onOrderCreated?.(result.data, submitted.current.payment);
                window.dispatchEvent(new Event("data-changed"));
            } else {
                const result = await request<string>("user/order/save", body);
                window.dispatchEvent(new Event("data-changed"));
                navigate("order/" + result.data);
                close();
            }
        } catch (problem) {
            const failure = problem as Error & {
                code?: string;
                status?: number;
            };
            const unknown =
                ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(
                    failure.code || "",
                ) || (failure.status || 0) >= 500;
            if (unified) {
                setUncertain(unknown);
                if (!unknown) submitted.current = undefined;
                if (failure.status === 409) preview.reload();
            }
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
                <fieldset
                    className="purchase-inputs"
                    disabled={busy || uncertain}
                >
                    <div className="purchase-body">
                        <section className="purchase-choices">
                            {unified && (
                                <div className="checkout-product">
                                    <h3>{plan.name}</h3>
                                    {Number(plan.transfer_enable) > 0 && (
                                        <p>
                                            {pc("trafficVolume")}{" "}
                                            {bytes(
                                                Number(plan.transfer_enable) *
                                                    1073741824,
                                            )}
                                            {Number(plan.device_limit) > 0 && (
                                                <>
                                                    {" "}
                                                    · {e("deviceLimit")}{" "}
                                                    {plan.device_limit}
                                                </>
                                            )}
                                        </p>
                                    )}
                                </div>
                            )}
                            <h3>
                                {tx(
                                    plan.resetOnly
                                        ? "流量重置"
                                        : "选择订阅周期",
                                )}
                            </h3>
                            <div
                                className="period-options"
                                role="group"
                                aria-label={tx("选择订阅周期")}
                            >
                                {available.map((key) => (
                                    <label
                                        key={key}
                                        className={
                                            period === key ? "selected" : ""
                                        }
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
                            {unified && (
                                <section className="checkout-method-section">
                                    <h3>{tx("选择支付方式")}</h3>
                                    {preview.loading && !serverQuote ? (
                                        <p className="muted" role="status">
                                            {pc("quoteLoading")}
                                        </p>
                                    ) : null}
                                    {paymentMethods.length > 0 && (
                                        <PaymentMethodPicker
                                            methods={paymentMethods}
                                            selected={methodId}
                                            disabled={busy || uncertain}
                                            onSelect={(id) => {
                                                manualPaymentSelection.current = true;
                                                setMethodId(id);
                                            }}
                                        />
                                    )}
                                    {serverQuote &&
                                        Number(serverQuote.total_amount) > 0 &&
                                        !serverQuote.methods?.length && (
                                            <p role="status">
                                                {pc("noPaymentMethods")}
                                            </p>
                                        )}
                                    {preview.error && (
                                        <div className="alert" role="alert">
                                            {preview.error}
                                            <button
                                                type="button"
                                                onClick={preview.reload}
                                            >
                                                {tx("重试")}
                                            </button>
                                        </div>
                                    )}
                                    {preview.expired && (
                                        <p role="status">
                                            {pc("quoteExpired")}{" "}
                                            <button
                                                type="button"
                                                onClick={preview.reload}
                                            >
                                                {tx("刷新")}
                                            </button>
                                        </p>
                                    )}
                                </section>
                            )}
                        </section>
                        <section
                            className="purchase-breakdown"
                            aria-label={pc("priceDetails")}
                        >
                            <h3>{pc("priceDetails")}</h3>
                            <dl className="checkout-lines" aria-live="polite">
                                {!unified && quote.cycleSaving > 0 && (
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
                                    <dd>
                                        {unified && !serverQuote
                                            ? "—"
                                            : money(
                                                  unified
                                                      ? serverQuote?.plan_amount
                                                      : quote.amount,
                                                  plan.currency,
                                              )}
                                    </dd>
                                </div>
                                {(unified
                                    ? Number(serverQuote?.discount_amount) > 0
                                    : Boolean(coupon)) && (
                                    <div className="discount-line">
                                        <dt>
                                            {tx("优惠金额")}
                                            <small>
                                                {!unified &&
                                                    pc("couponBase", {
                                                        percent:
                                                            coupon!
                                                                .discountPercent,
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
                                                unified
                                                    ? serverQuote?.discount_amount
                                                    : quote.couponSaving,
                                                plan.currency,
                                            )}
                                        </dd>
                                    </div>
                                )}
                                {unified && serverQuote && (
                                    <>
                                        {Number(serverQuote.surplus_amount) >
                                            0 && (
                                            <div>
                                                <dt>{pc("surplusCredit")}</dt>
                                                <dd>
                                                    −
                                                    {money(
                                                        serverQuote.surplus_amount,
                                                        plan.currency,
                                                    )}
                                                </dd>
                                            </div>
                                        )}
                                        {Number(serverQuote.refund_amount) >
                                            0 && (
                                            <div>
                                                <dt>{pc("surplusRefund")}</dt>
                                                <dd>
                                                    +
                                                    {money(
                                                        serverQuote.refund_amount,
                                                        plan.currency,
                                                    )}
                                                </dd>
                                            </div>
                                        )}
                                        {Number(serverQuote.balance_amount) >
                                            0 && (
                                            <div>
                                                <dt>{tx("余额抵扣")}</dt>
                                                <dd>
                                                    −
                                                    {money(
                                                        serverQuote.balance_amount,
                                                        plan.currency,
                                                    )}
                                                </dd>
                                            </div>
                                        )}
                                        {Number(serverQuote.handling_amount) >
                                            0 && (
                                            <div>
                                                <dt>{tx("支付手续费")}</dt>
                                                <dd>
                                                    {money(
                                                        serverQuote.handling_amount,
                                                        plan.currency,
                                                    )}
                                                </dd>
                                            </div>
                                        )}
                                    </>
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
                </fieldset>
                <div className="purchase-footer">
                    <div className="purchase-footer-total" aria-live="polite">
                        <span className="purchase-footer-context">
                            {plan.name} · {tx(billingPeriods[period] || "")}
                        </span>
                        <span>
                            {unified
                                ? pc("amountDue")
                                : pc(
                                      coupon
                                          ? "couponEstimate"
                                          : "estimatedSubtotal",
                                  )}
                        </span>
                        <strong>
                            {unified
                                ? serverQuote &&
                                  !preview.loading &&
                                  !preview.error
                                    ? money(
                                          serverQuote.payment_amount,
                                          serverQuote.payment_currency,
                                      )
                                    : "—"
                                : money(quote.subtotal, plan.currency)}
                        </strong>
                        <small>
                            {unified
                                ? pc("quoteNotice")
                                : pc("estimateExclusions")}
                        </small>
                    </div>
                    <button
                        className="primary purchase-primary"
                        disabled={
                            busy ||
                            !period ||
                            (unified &&
                                !uncertain &&
                                (!serverQuote?.quote_token ||
                                    preview.loading ||
                                    preview.expired ||
                                    Boolean(preview.error)))
                        }
                    >
                        {busy
                            ? tx("提交中…")
                            : uncertain
                              ? tx("重试")
                              : unified
                                ? pc("confirmAndPay")
                                : tx("创建订单并继续")}
                    </button>
                </div>
            </fieldset>
        </form>
    );
}
