import { OrderReceipt } from "./OrderReceipt";
import { OrderHelp } from "./OrderHelp";
import { PaymentMethodPicker } from "./PaymentMethodPicker";
import { c, minuteDate } from "../shared/credit-copy";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, LoaderCircle, ReceiptText } from "lucide-react";
import { request, bytes, money as formatMoney, query, type Row } from "../shared/api";
import { useData, State, Modal } from "../shared/ui";
import { tx } from "../shared/i18n";
import { billingPeriods, paymentFee, orderOriginalAmount } from "./billing-flow";
import { PurchaseSteps } from "./SubscriptionPurchase";

export function PaymentCheckout({
    order,
    reload,
    renderCard,
}: {
    order: Row;
    reload: () => void;
    renderCard: (
        method: number,
        pay: (token: string) => Promise<void>,
    ) => ReactNode;
}) {
    const money = (amount: unknown) => formatMoney(amount, order.currency || "CNY");
    const status = Number(order.status);
    const deposit = Number(order.plan_id) === 0;
    const due = Number(order.total_amount || 0);
    const methods = useData<Row[]>(
        status === 0 && due > 0 ? "user/order/getPaymentMethod" : "",
        undefined,
        false,
        // A successful checkout emits data-changed immediately before navigation.
        // Keep the loaded methods stable; order status has its own polling lifecycle.
        { refreshOnEvents: false },
    );
    const [selected, setSelected] = useState<number>(
        Number(order.payment_id || -1),
    );
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [qr, setQr] = useState("");
    const [waiting, setWaiting] = useState(due > 0 && Boolean(order.payment_id));
    const [issuedFee, setIssuedFee] = useState(Number(order.handling_amount || 0));
    const [cancelOpen, setCancelOpen] = useState(false),
        [cardMethod, setCardMethod] = useState<number | null>(null);
    const [pollError, setPollError] = useState("");
    const [pollStopped, setPollStopped] = useState(false);
    const [pollRun, setPollRun] = useState(0);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const inFlight = useRef(false);
    const refresh = useRef(reload);
    refresh.current = reload;
    const method = methods.data?.find((item) => Number(item.id) === selected);
    const fee =
        status === 0
            ? waiting ? issuedFee : paymentFee(due, method)
            : Number(order.handling_amount || 0);
    const feeReady = status !== 0 || waiting || due <= 0 || Boolean(method);
    const awaitingConfirmation = waiting;
    useEffect(() => {
        if (
            !waiting && selected !== 0 && methods.data?.length &&
            !methods.data.some((item) => Number(item.id) === selected)
        )
            setSelected(Number(methods.data.find(item => item.category !== "crypto")?.id || (methods.data.length === 1 ? methods.data[0].id : 0)));
    }, [methods.data, selected, waiting]);
    useEffect(() => {
        if (status !== 0) {
            setQr("");
            setCardMethod(null);
        }
    }, [status]);
    useEffect(() => {
        if (status !== 1 && !(status === 0 && waiting)) return;
        setPollStopped(false);
        let live = true,
            checks = 0,
            checking = false;
        async function check() {
            if (!live || checking || document.visibilityState === "hidden")
                return;
            if (checks >= 60) {
                setPollStopped(true);
                return;
            }
            checks++;
            checking = true;
            try {
                const result = await request<number>(
                    query("user/order/check", { trade_no: order.trade_no }),
                );
                if (!live) return;
                setPollError("");
                if (Number(result.data) !== status) {
                    refresh.current();
                    window.dispatchEvent(new Event("data-changed"));
                }
            } catch (problem) {
                if (live) setPollError((problem as Error).message);
            } finally {
                checking = false;
            }
        }
        void check();
        const timer = setInterval(() => {
            if (checks >= 60 && !checking) {
                setPollStopped(true);
                clearInterval(timer);
            } else void check();
        }, 5000);
        const visible = () => {
            if (document.visibilityState !== "hidden") void check();
        };
        document.addEventListener("visibilitychange", visible);
        window.addEventListener("focus", visible);
        return () => {
            live = false;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", visible);
            window.removeEventListener("focus", visible);
        };
    }, [status, waiting, order.trade_no, pollRun]);
    async function pay(id: number, token?: string) {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        setWaiting(false);
        setQr("");
        try {
            const result = await request("user/order/checkout", {
                trade_no: order.trade_no,
                method: id,
                ...(token ? { token } : {}),
            }, { timeoutMs: 45000 });
            setIssuedFee(paymentFee(due, methods.data?.find((item) => Number(item.id) === id)));
            if (result.type === -1 || result.type === 2) {
                setWaiting(true);
                setCardMethod(null);
                reload();
            } else if (
                result.type === 1 &&
                typeof result.data === "string" &&
                /^https?:\/\//i.test(result.data)
            ) {
                setWaiting(true);
                location.assign(result.data);
            } else if (
                result.type === 0 &&
                typeof result.data === "string" &&
                result.data
            ) {
                setQr(result.data);
                setWaiting(true);
            } else
                throw new Error(
                    tx("此支付方式需要专用客户端，请选择其他方式。"),
                );
        } catch (problem) {
            const failure = problem as Error & { code?: string; status?: number };
            if (["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(failure.code || "") || (failure.status || 0) >= 500) {
                setIssuedFee(paymentFee(due, methods.data?.find((item) => Number(item.id) === id)));
                setWaiting(true);
                setPollRun((run) => run + 1);
                setError(tx("未能确认支付请求结果，正在检查订单状态，请勿重复付款。"));
            } else setError(failure.message);
            if (token) setCardMethod(null);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    async function cancel() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            await request("user/order/cancel", { trade_no: order.trade_no });
            setCancelOpen(false);
            setQr("");
            reload();
        } catch (problem) {
            setError((problem as Error).message);
            setCancelOpen(false);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    if ([2, 3, 4].includes(status)) return <OrderReceipt order={order} />;
    if (![0, 1].includes(status)) return <div className="checkout-page">
        <a className="receipt-back" href="#/order"><ArrowLeft size={16} />{tx("账单")}</a>
        <div className="alert" role="alert">{tx("订单状态暂不可用，请刷新后重试。")}
            <button onClick={reload}>{tx("刷新")}</button>
        </div>
    </div>;
    return (
        <div className="checkout-page">
            <a className="receipt-back" href="#/order"><ArrowLeft size={16} />{tx("账单")}</a>
            <header className="checkout-heading">
                <div>
                    <h1>{tx(status === 1 ? "支付已确认，正在开通" : "确认与支付")}</h1>
                    <p>{tx(status === 1 ? "开通结果将自动更新，请勿重复支付。" : "请核对订单，选择支付方式后继续。")}</p>
                </div>
                <span className={`checkout-status ${status === 1 ? "processing" : ""}`}>
                    {status === 1 ? <LoaderCircle size={14} /> : <ReceiptText size={14} />}
                    {tx(status === 1 ? "开通中" : "待支付")}
                </span>
            </header>
            {!order.credit_bytes && !deposit && <PurchaseSteps step={2} />}
            <div
                className={
                    status === 1
                        ? "checkout-layout checkout-processing"
                        : "checkout-layout"
                }
            >
                <section className="checkout-summary">
                    <span className="checkout-section-label">{tx("订单详情")}</span>
                    <h2>
                        {order.credit_bytes
                            ? c("credits")
                            : deposit
                              ? tx("账户充值")
                              : order.plan?.name}
                    </h2>
                    <p className="muted">
                        {order.credit_bytes
                            ? order.credit_snapshot?.name
                            : tx(billingPeriods[order.period] || "账户充值")}
                    </p>
                    {Number(order.credit_bytes) > 0 && <p className="checkout-product-quantity">{bytes(order.credit_bytes)}</p>}
                    <button className="checkout-details-toggle" type="button" aria-expanded={summaryOpen}
                        onClick={() => setSummaryOpen((open) => !open)}>
                        {tx("订单详情")} <span aria-hidden="true">{summaryOpen ? "−" : "+"}</span>
                    </button>
                    <div className="checkout-details" data-expanded={summaryOpen}>
                    <dl className="checkout-lines">
                        <div>
                            <dt>{tx(deposit ? "充值金额" : Number(order.credit_bytes) > 0 ? "额度价格" : "套餐价格")}</dt>
                            <dd>{money(orderOriginalAmount(order))}</dd>
                        </div>
                        {Number(order.discount_amount) > 0 && (
                            <div>
                                <dt>{tx("优惠金额")}</dt>
                                <dd>−{money(order.discount_amount)}</dd>
                            </div>
                        )}
                        {Number(order.surplus_amount) > 0 && (
                            <div>
                                <dt>{tx("旧套餐折抵")}</dt>
                                <dd>
                                    −
                                    {money(
                                        Number(order.surplus_amount) -
                                            Number(order.refund_amount || 0),
                                    )}
                                </dd>
                            </div>
                        )}
                        {Number(order.balance_amount) > 0 && (
                            <div>
                                <dt>{tx("余额抵扣")}</dt>
                                <dd>−{money(order.balance_amount)}</dd>
                            </div>
                        )}
                        {(fee > 0 || !feeReady) && <div>
                            <dt>{tx("支付手续费")}</dt>
                            <dd>{feeReady ? money(fee) : "—"}</dd>
                        </div>}
                        {status === 1 && <div className="checkout-total">
                            <dt>{tx("合计")}</dt><dd>{money(due + fee)}</dd>
                        </div>}
                        {Number(order.refund_amount) > 0 && (
                            <div>
                                <dt>{tx("退回余额")}</dt>
                                <dd>{money(order.refund_amount)}</dd>
                            </div>
                        )}
                    </dl>
                    {deposit && Number(order.bounus) > 0 && <div className="checkout-deposit-benefit">
                        <span>{tx("充值赠送")} +{money(order.bounus)}</span>
                        <strong>{tx("到账金额")} {money(order.get_amount)}</strong>
                    </div>}
                    <details className="order-reference">
                        <summary>{tx("订单信息")}</summary>
                        <p>
                            {tx("订单编号")}
                            <br />
                            <span dir="ltr">{order.trade_no}</span>
                        </p>
                        <p>{c("created")}<br />{minuteDate(order.created_at)}</p>
                    </details>
                    </div>
                </section>
                {status === 0 && (
                    <section className="checkout-payment">
                        <div className="checkout-amount" aria-live="polite" aria-atomic="true">
                            <span>{tx("应付金额")}</span>
                            <strong>{feeReady ? money(due + fee) : "—"}</strong>
                        </div>
                        <h2>{tx(due > 0 ? "选择支付方式" : "确认开通")}</h2>
                        {due <= 0 && <p className="muted">{tx("无需外部付款，确认后将处理订单。")}</p>}
                        {error && (
                            <div className="alert" role="alert">
                                {error}
                            </div>
                        )}
                        {due > 0 && (
                            <State {...methods} retry={methods.reload}>
                                <PaymentMethodPicker methods={methods.data || []} selected={selected}
                                    disabled={busy || awaitingConfirmation}
                                    onSelect={(id) => { setSelected(id); setQr(""); setWaiting(false); setError(""); }} />
                                {!methods.data?.length && (
                                    <p className="muted">
                                        {tx("暂无可用支付方式，请联系客服。")}
                                    </p>
                                )}
                            </State>
                        )}
                        {qr && (
                            <div className="checkout-qr">
                                <QRCodeSVG
                                    value={qr}
                                    size={200}
                                    marginSize={3}
                                />
                                <p>{tx("扫码支付后，页面会自动检查结果。")}</p>
                                <input
                                    aria-label={tx("付款内容")}
                                    readOnly
                                    value={qr}
                                />
                                <button
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(
                                                qr,
                                            );
                                        } catch {
                                            setError(
                                                tx("复制失败，请手动复制链接"),
                                            );
                                        }
                                    }}
                                >
                                    {tx("复制")}
                                </button>
                            </div>
                        )}
                        <div className="checkout-confirm">
                            <button
                                className="primary"
                                disabled={
                                    busy ||
                                    (!awaitingConfirmation &&
                                        due > 0 &&
                                        (!method ||
                                            methods.loading ||
                                            Boolean(methods.error)))
                                }
                                onClick={() =>
                                    awaitingConfirmation
                                        ? reload()
                                        : method?.payment === "StripeCredit" &&
                                            due > 0
                                          ? setCardMethod(Number(method.id))
                                          : pay(due > 0 ? selected : 0)
                                }
                            >
                                {busy && <LoaderCircle className="checkout-spinner" size={18} aria-hidden="true" />}
                                {tx(
                                    busy
                                        ? "提交中…"
                                        : awaitingConfirmation
                                          ? "检查支付结果"
                                          : due > 0
                                            ? "确认支付"
                                            : "确认开通",
                                )}
                            </button>
                        </div>
                        {waiting && (
                            <p role="status" className="muted">
                                {tx("正在等待支付确认，请勿重复付款。")}
                            </p>
                        )}
                        <div className="checkout-secondary">
                            <OrderHelp tradeNo={String(order.trade_no)} />
                            <div className="checkout-secondary-actions">
                            {awaitingConfirmation ? (
                                <button
                                    disabled={busy}
                                    onClick={() => {
                                        setWaiting(false);
                                        setQr("");
                                        setError("");
                                    }}
                                >
                                    {tx("重新发起支付")}
                                </button>
                            ) : null}
                            <button
                                disabled={busy}
                                onClick={() => setCancelOpen(true)}
                            >
                                {tx("取消订单")}
                            </button>
                            </div>
                        </div>
                    </section>
                )}
            </div>
            {pollStopped && (
                <div className="alert" role="status">
                    {tx("自动检查已暂停，订单仍可继续处理，请勿重复付款。")}
                    <button
                        onClick={() => {
                            setPollRun((run) => run + 1);
                            reload();
                        }}
                    >
                        {tx("继续检查")}
                    </button>
                </div>
            )}
            {pollError && (
                <div className="alert" role="alert">
                    {pollError}
                    <button onClick={reload}>{tx("检查支付结果")}</button>
                </div>
            )}
            {status === 1 && <div className="checkout-processing-actions">
                <button onClick={reload}>{tx("检查支付结果")}</button>
                <OrderHelp tradeNo={String(order.trade_no)} />
            </div>}
            {cancelOpen && (
                <Modal
                    title={tx("取消订单")}
                    close={() => {
                        if (!busy) setCancelOpen(false);
                    }}
                >
                    <div className="pad">
                        <p>
                            {tx(
                                "取消后，已抵扣的余额会返还。已付款时请先检查支付结果。",
                            )}
                        </p>
                        <div className="actions">
                            <button
                                disabled={busy}
                                onClick={() => setCancelOpen(false)}
                            >
                                {tx("继续支付")}
                            </button>
                            <button disabled={busy} onClick={cancel}>
                                {tx(busy ? "提交中…" : "确认取消订单")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
            {cardMethod && status === 0 && (
                <Modal
                    title={tx("信用卡支付")}
                    close={() => {
                        if (!busy) setCardMethod(null);
                    }}
                >
                    <div className="checkout-card">
                        <p className="pad">
                            {tx("合计")} {money(due + fee)}
                        </p>
                        {renderCard(cardMethod, (token) =>
                            pay(cardMethod, token),
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}
