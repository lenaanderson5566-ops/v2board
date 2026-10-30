import { trackAction, useAnalyticsPage } from "./product-analytics";
import { OrderReceipt } from "./OrderReceipt";
import { OrderHelp } from "./OrderHelp";
import { BrowserHandoffHelp } from "./BrowserHandoffHelp";
import { PaymentIcon, PaymentMethodPicker } from "./PaymentMethodPicker";
import { c, minuteDate } from "../shared/credit-copy";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, LoaderCircle, ReceiptText } from "lucide-react";
import {
    request,
    bytes,
    money as formatMoney,
    query,
    type Row,
} from "../shared/api";
import { useData, State, Modal } from "../shared/ui";
import { tx } from "../shared/i18n";
import { e } from "../shared/experience-copy";
import {
    billingPeriods,
    paymentFee,
    orderOriginalAmount,
} from "./billing-flow";
import { pricingCopy as pc } from "./pricing-copy";
import { PurchaseSteps } from "./PurchaseSteps";
import {
    nativeWechatQr,
    paymentActionUrl,
    qrPaymentActionUrl,
} from "./payment-action";

export type PaymentQuote = { amount: number; currency: string; fee: number };

export type InitialPayment = {
    methodId: number;
    amount: number;
    currency: string;
    requestKey: string;
};
export function PaymentCheckout({
    order,
    reload,
    renderCard,
    initialPayment,
    embedded = false,
    compact = false,
    onQuoteChange,
}: {
    initialPayment?: InitialPayment;
    embedded?: boolean;
    compact?: boolean;
    onQuoteChange?: (quote: PaymentQuote | undefined) => void;
    order: Row;
    reload: () => void;
    renderCard: (
        method: number,
        pay: (token: string) => Promise<void>,
    ) => ReactNode;
}) {
    const money = (amount: unknown) =>
        formatMoney(amount, order.currency || "CNY");
    const status = Number(order.status);
    const deposit = Number(order.plan_id) === 0;
    const due = Number(order.total_amount || 0);
    useAnalyticsPage(
        status === 0 && !deposit && order.period !== "reset_price"
            ? "payment"
            : null,
    );
    const methods = useData<Row[]>(
        status === 0 && due > 0
            ? query("user/order/getPaymentMethod", { trade_no: order.trade_no })
            : "",
        undefined,
        false,
        // A successful checkout emits data-changed before entering payment.
        // Keep the loaded methods stable; order status has its own polling lifecycle.
        { refreshOnEvents: false },
    );
    const [selected, setSelected] = useState<number>(
        Number(order.payment_id || initialPayment?.methodId || -1),
    );
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [qr, setQr] = useState("");
    const [paymentLink, setPaymentLink] = useState("");
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState("");
    const [smallScreen, setSmallScreen] = useState(
        () => window.innerWidth <= 800,
    );
    useEffect(() => {
        const resize = () => setSmallScreen(window.innerWidth <= 800);
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    useEffect(() => {
        setCopied(false);
        setCopyError("");
    }, [qr, paymentLink]);
    const qrPanel = useRef<HTMLDivElement>(null);
    const paymentActionPanel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (
            !embedded ||
            !qr ||
            !qrPanel.current ||
            qrPanel.current.closest("details:not([open])")
        )
            return;
        const target = compact
            ? qrPanel.current.querySelector("svg") || qrPanel.current
            : qrPanel.current;
        const bounds = target.getBoundingClientRect();
        if (bounds.top >= 80 && bounds.bottom <= window.innerHeight - 80)
            return;
        target.scrollIntoView?.({
            block: compact && window.innerWidth <= 800 ? "center" : "nearest",
            behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
                ?.matches
                ? "instant"
                : "smooth",
        });
    }, [embedded, compact, qr]);
    const [waiting, setWaiting] = useState(
        due > 0 && Boolean(order.payment_id),
    );
    const [issuedFee, setIssuedFee] = useState(
        Number(order.handling_amount || 0),
    );
    const [issuedQuote, setIssuedQuote] = useState({
        amount: order.payment_amount,
        currency: order.payment_currency,
    });
    const [retryOpen, setRetryOpen] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false),
        [cardMethod, setCardMethod] = useState<number | null>(null);
    const cardSession = useMemo(() => ({ method: cardMethod }), [cardMethod]);
    const activeCardSession = useRef(cardSession);
    activeCardSession.current = cardSession;
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [pollError, setPollError] = useState("");
    const [pollStopped, setPollStopped] = useState(false);
    const [pollRun, setPollRun] = useState(0);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const inFlight = useRef(false);
    const autoStarted = useRef(false);
    const paymentKey = useRef(
        initialPayment?.requestKey || crypto.randomUUID(),
    );
    const keyedMethod = useRef(initialPayment?.methodId);
    const refresh = useRef(reload);
    refresh.current = reload;
    const serverPayment = JSON.stringify([
        order.payment_id,
        order.payment_amount,
        order.payment_currency,
        order.handling_amount,
    ]);
    const observedPayment = useRef(serverPayment);
    const newServerPayment =
        Boolean(order.payment_id) && observedPayment.current !== serverPayment;
    useEffect(() => {
        observedPayment.current = serverPayment;
        if (!newServerPayment || status !== 0) return;
        setSelected(Number(order.payment_id));
        setIssuedFee(Number(order.handling_amount || 0));
        setIssuedQuote({
            amount: order.payment_amount,
            currency: order.payment_currency,
        });
        setWaiting(true);
        setCardMethod(null);
        if (
            Number(order.payment_id) !== selected ||
            (order.payment_amount != null &&
                Number(order.payment_amount) !== Number(issuedQuote.amount)) ||
            (order.payment_currency &&
                order.payment_currency !== issuedQuote.currency)
        ) {
            setQr("");
            setPaymentLink("");
        }
    }, [serverPayment, status]);
    const method = methods.data?.find((item) => Number(item.id) === selected);
    const openUrl =
        status === 0
            ? paymentLink ||
              (smallScreen && qr
                  ? qrPaymentActionUrl(qr, String(method?.payment || ""))
                  : undefined)
            : undefined;
    useEffect(() => {
        if (!smallScreen || !openUrl || !paymentActionPanel.current) return;
        const target = paymentActionPanel.current;
        const bounds = target.getBoundingClientRect();
        if (bounds.top >= 80 && bounds.bottom <= window.innerHeight - 80)
            return;
        target.scrollIntoView?.({
            block: "center",
            behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
                ?.matches
                ? "instant"
                : "smooth",
        });
    }, [smallScreen, openUrl]);
    const fee =
        status === 0
            ? waiting
                ? issuedFee
                : Number(method?.quoted_fee ?? paymentFee(due, method))
            : Number(order.handling_amount || 0);
    const feeReady = status !== 0 || waiting || due <= 0 || Boolean(method);
    const paymentAmount = waiting ? issuedQuote.amount : method?.quoted_amount;
    const paymentCurrency = waiting
        ? issuedQuote.currency
        : method?.quoted_currency;
    const awaitingConfirmation = waiting || newServerPayment;
    const paymentLocked = useRef(false);
    paymentLocked.current = awaitingConfirmation || status !== 0;
    const displayedAmount = Number(
        (status !== 0 ? order.payment_amount : paymentAmount) ?? due + fee,
    );
    const displayedCurrency = String(
        (status !== 0 ? order.payment_currency : paymentCurrency) ||
            order.currency ||
            "CNY",
    );
    useEffect(() => {
        onQuoteChange?.(
            feeReady
                ? {
                      amount: displayedAmount,
                      currency: displayedCurrency,
                      fee,
                  }
                : undefined,
        );
    }, [feeReady, displayedAmount, displayedCurrency, fee, onQuoteChange]);
    useEffect(() => {
        if (
            !waiting &&
            selected !== 0 &&
            methods.data?.length &&
            !methods.data.some((item) => Number(item.id) === selected)
        )
            setSelected(
                Number(
                    methods.data.find((item) => item.category !== "crypto")
                        ?.id ||
                        (methods.data.length === 1 ? methods.data[0].id : 0),
                ),
            );
    }, [methods.data, selected, waiting]);
    useEffect(() => {
        if (status !== 0) {
            setQr("");
            setPaymentLink("");
            setCardMethod(null);
            setRetryOpen(false);
        }
    }, [status]);
    useEffect(() => {
        if (status !== 1 && !(status === 0 && waiting)) return;
        setPollStopped(false);
        let live = true,
            checks = 0,
            checking = false,
            observedChange = false;
        const controller = new AbortController();
        async function check() {
            if (
                !live ||
                checking ||
                observedChange ||
                document.visibilityState === "hidden"
            )
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
                    undefined,
                    { signal: controller.signal },
                );
                if (!live) return;
                setPollError("");
                if (Number(result.data) !== status) {
                    observedChange = true;
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
            if (observedChange) {
                clearInterval(timer);
            } else if (checks >= 60 && !checking) {
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
            controller.abort();
            clearInterval(timer);
            document.removeEventListener("visibilitychange", visible);
            window.removeEventListener("focus", visible);
        };
    }, [status, waiting, order.trade_no, pollRun]);
    async function pay(id: number, token?: string) {
        if (inFlight.current || paymentLocked.current || !mounted.current)
            return;
        inFlight.current = true;
        if (paymentKey.current && keyedMethod.current !== id) {
            paymentKey.current = crypto.randomUUID();
            keyedMethod.current = id;
        }
        setBusy(true);
        setError("");
        setWaiting(false);
        setQr("");
        setPaymentLink("");
        try {
            const result = await request(
                "user/order/checkout",
                {
                    trade_no: order.trade_no,
                    method: id,
                    expected_payment_amount: methods.data?.find(
                        (item) => Number(item.id) === id,
                    )?.quoted_amount,
                    expected_payment_currency: methods.data?.find(
                        (item) => Number(item.id) === id,
                    )?.quoted_currency,
                    ...(token ? { token } : {}),
                    ...(paymentKey.current
                        ? { payment_request_key: paymentKey.current }
                        : {}),
                },
                { timeoutMs: 45000 },
            );
            if (!mounted.current) return;
            setIssuedFee(
                Number(
                    methods.data?.find((item) => Number(item.id) === id)
                        ?.quoted_fee ??
                        paymentFee(
                            due,
                            methods.data?.find(
                                (item) => Number(item.id) === id,
                            ),
                        ),
                ),
            );
            const quotedMethod = methods.data?.find(
                (item) => Number(item.id) === id,
            );
            setIssuedQuote({
                amount: quotedMethod?.quoted_amount,
                currency: quotedMethod?.quoted_currency,
            });
            if (result.type === -1 || result.type === 2) {
                setWaiting(true);
                setCardMethod(null);
                reload();
            } else if (result.type === 1 && typeof result.data === "string") {
                const action = paymentActionUrl(result.data);
                setWaiting(true);
                setCardMethod(null);
                if (action) {
                    setPaymentLink(action);
                    if (!smallScreen && /^https?:/i.test(action))
                        location.assign(action);
                } else if (nativeWechatQr(result.data)) {
                    // Native WeChat QR data is scan-only; it is not an H5 payment URL.
                    setQr(result.data);
                } else {
                    setError(tx("此支付方式需要专用客户端，请选择其他方式。"));
                }
            } else if (
                result.type === 0 &&
                typeof result.data === "string" &&
                result.data
            ) {
                setQr(result.data);
                setCardMethod(null);
                setWaiting(true);
            } else
                throw new Error(
                    tx("此支付方式需要专用客户端，请选择其他方式。"),
                );
        } catch (problem) {
            if (!mounted.current) return;
            const failure = problem as Error & {
                code?: string;
                status?: number;
            };
            if (failure.status === 409) methods.reload();
            if (
                ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(
                    failure.code || "",
                ) ||
                (failure.status || 0) >= 500
            ) {
                setIssuedFee(
                    Number(
                        methods.data?.find((item) => Number(item.id) === id)
                            ?.quoted_fee ??
                            paymentFee(
                                due,
                                methods.data?.find(
                                    (item) => Number(item.id) === id,
                                ),
                            ),
                    ),
                );
                const confirmed = methods.data?.find(
                    (item) => Number(item.id) === id,
                );
                setIssuedQuote({
                    amount: confirmed?.quoted_amount,
                    currency: confirmed?.quoted_currency,
                });
                setWaiting(true);
                setPollRun((run) => run + 1);
                setError(
                    tx(
                        "未能确认支付请求结果，正在检查订单状态，请勿重复付款。",
                    ),
                );
            } else setError(failure.message);
            if (token) setCardMethod(null);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    useEffect(() => {
        if (
            !initialPayment ||
            autoStarted.current ||
            status !== 0 ||
            awaitingConfirmation ||
            methods.loading ||
            methods.error
        )
            return;
        const selectedMethod = methods.data?.find(
            (item) => Number(item.id) === initialPayment.methodId,
        );
        if (due > 0 && !methods.data) return;
        autoStarted.current = true;
        if (
            due > 0 &&
            (!selectedMethod ||
                Number(selectedMethod.quoted_amount) !==
                    initialPayment.amount ||
                selectedMethod.quoted_currency !== initialPayment.currency)
        ) {
            setError(pc("quoteChanged"));
            return;
        }
        if (due > 0 && selectedMethod?.payment === "StripeCredit")
            setCardMethod(initialPayment.methodId);
        else void pay(due > 0 ? initialPayment.methodId : 0);
    }, [
        initialPayment,
        status,
        waiting,
        methods.data,
        methods.loading,
        methods.error,
        due,
    ]);
    async function cancel() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            await request("user/order/cancel", { trade_no: order.trade_no });
            setCancelOpen(false);
            setQr("");
            setPaymentLink("");
            reload();
        } catch (problem) {
            setError((problem as Error).message);
            setCancelOpen(false);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    async function restartPayment() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await request<number>(
                query("user/order/check", { trade_no: order.trade_no }),
            );
            if (Number(result.data) === 0) {
                setWaiting(false);
                setQr("");
                setPaymentLink("");
                if (paymentKey.current)
                    paymentKey.current = crypto.randomUUID();
                methods.reload();
            } else reload();
            setRetryOpen(false);
        } catch (problem) {
            setError((problem as Error).message);
            setRetryOpen(false);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    async function copyPayment() {
        setCopied(false);
        setCopyError("");
        try {
            await navigator.clipboard.writeText(qr || paymentLink);
            setCopied(true);
            trackAction("copy_success", "payment");
        } catch {
            trackAction("copy_failed", "payment");
            setCopyError(tx("复制失败，请手动复制链接"));
        }
    }
    const paymentDetails = (
        <>
            <input
                aria-label={tx("付款内容")}
                readOnly
                value={qr || paymentLink}
            />
            {!smallScreen && (
                <button type="button" onClick={copyPayment}>
                    {tx("复制")}
                </button>
            )}
            {!smallScreen && copyError && (
                <p role="alert" className="checkout-copy-error">
                    {copyError}
                </p>
            )}
        </>
    );
    const secondaryActions = (
        <>
            <div className="checkout-secondary">
                <OrderHelp tradeNo={String(order.trade_no)} />
                <div className="checkout-secondary-actions">
                    {awaitingConfirmation ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRetryOpen(true)}
                        >
                            {tx("重新发起支付")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCancelOpen(true)}
                    >
                        {tx("取消订单")}
                    </button>
                </div>
            </div>
        </>
    );
    const qrContent = qr && (
        <div ref={qrPanel} className="checkout-qr">
            {method && !compact && (
                <p className="checkout-qr-channel">
                    <strong>{method.name}</strong>
                    {method.category === "crypto" && (
                        <span>
                            {method.asset} ·{" "}
                            {method.network_name || method.network}
                        </span>
                    )}
                </p>
            )}
            <QRCodeSVG value={qr} size={200} marginSize={3} />
            <p>
                {smallScreen
                    ? pc("mobileScanHelp")
                    : tx("扫码支付后，页面会自动检查结果。")}
            </p>
            {compact ? (
                <details className="checkout-payment-details">
                    <summary>{tx("付款内容")}</summary>
                    {paymentDetails}
                </details>
            ) : (
                paymentDetails
            )}
        </div>
    );
    if ([2, 3, 4].includes(status))
        return (
            <OrderReceipt order={order} embedded={embedded} compact={compact} />
        );
    if (![0, 1].includes(status))
        return (
            <div className={compact ? "checkout-inline" : "checkout-page"}>
                {!embedded && (
                    <a className="receipt-back" href="#/order">
                        <ArrowLeft size={16} />
                        {tx("账单")}
                    </a>
                )}
                <div className="alert" role="alert">
                    {tx("订单状态暂不可用，请刷新后重试。")}
                    <button type="button" onClick={reload}>
                        {tx("刷新")}
                    </button>
                </div>
            </div>
        );
    return (
        <div
            className={
                compact
                    ? "checkout-inline"
                    : `checkout-page${embedded ? " checkout-embedded" : ""}`
            }
        >
            {!embedded && (
                <a className="receipt-back" href="#/order">
                    <ArrowLeft size={16} />
                    {tx("账单")}
                </a>
            )}
            <header className="checkout-heading">
                {!embedded && (
                    <div>
                        <h1>
                            {tx(
                                status === 1
                                    ? "支付已确认，正在开通"
                                    : "确认与支付",
                            )}
                        </h1>
                        {(status === 1 || !waiting) && (
                            <p>
                                {tx(
                                    status === 1
                                        ? "开通结果将自动更新，请勿重复支付。"
                                        : "请核对订单，选择支付方式后继续。",
                                )}
                            </p>
                        )}
                    </div>
                )}
                <span
                    className={`checkout-status ${status === 1 ? "processing" : ""}`}
                >
                    {status === 1 ? (
                        <LoaderCircle size={14} />
                    ) : (
                        <ReceiptText size={14} />
                    )}
                    {tx(status === 1 ? "开通中" : "待支付")}
                </span>
            </header>
            {!embedded && !order.credit_bytes && !deposit && (
                <PurchaseSteps step={2} />
            )}
            <div
                className={
                    compact
                        ? "checkout-inline-layout"
                        : status === 1
                          ? "checkout-layout checkout-processing"
                          : "checkout-layout"
                }
            >
                {!compact && (
                    <section className="checkout-summary">
                        <span className="checkout-section-label">
                            {tx("订单详情")}
                        </span>
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
                                : tx(
                                      billingPeriods[order.period] ||
                                          "账户充值",
                                  )}
                        </p>
                        {Number(order.credit_bytes) > 0 && (
                            <p className="checkout-product-quantity">
                                {bytes(order.credit_bytes)}
                            </p>
                        )}
                        <button
                            type="button"
                            className="checkout-details-toggle"
                            aria-expanded={summaryOpen}
                            onClick={() => setSummaryOpen((open) => !open)}
                        >
                            {tx("订单详情")}{" "}
                            <span aria-hidden="true">
                                {summaryOpen ? "−" : "+"}
                            </span>
                        </button>
                        <div
                            className="checkout-details"
                            data-expanded={summaryOpen}
                        >
                            <dl className="checkout-lines">
                                <div>
                                    <dt>
                                        {tx(
                                            deposit
                                                ? "充值金额"
                                                : Number(order.credit_bytes) > 0
                                                  ? "额度价格"
                                                  : "套餐价格",
                                        )}
                                    </dt>
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
                                                    Number(
                                                        order.refund_amount ||
                                                            0,
                                                    ),
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
                                {(fee > 0 || !feeReady) && (
                                    <div>
                                        <dt>{tx("支付手续费")}</dt>
                                        <dd>{feeReady ? money(fee) : "—"}</dd>
                                    </div>
                                )}
                                {status === 1 && (
                                    <div className="checkout-total">
                                        <dt>{tx("合计")}</dt>
                                        <dd>{money(due + fee)}</dd>
                                    </div>
                                )}
                                {Number(order.refund_amount) > 0 && (
                                    <div>
                                        <dt>{tx("退回余额")}</dt>
                                        <dd>{money(order.refund_amount)}</dd>
                                    </div>
                                )}
                            </dl>
                            {deposit && Number(order.bounus) > 0 && (
                                <div className="checkout-deposit-benefit">
                                    <span>
                                        {tx("充值赠送")} +{money(order.bounus)}
                                    </span>
                                    <strong>
                                        {tx("到账金额")}{" "}
                                        {money(order.get_amount)}
                                    </strong>
                                </div>
                            )}
                            <details className="order-reference">
                                <summary>{tx("订单信息")}</summary>
                                <p>
                                    {tx("订单编号")}
                                    <br />
                                    <span dir="ltr">{order.trade_no}</span>
                                </p>
                                <p>
                                    {c("created")}
                                    <br />
                                    {minuteDate(order.created_at)}
                                </p>
                            </details>
                        </div>
                    </section>
                )}
                {compact && status === 1 && (
                    <p role="status">
                        {tx("支付已确认，正在开通")} ·{" "}
                        {tx("开通结果将自动更新，请勿重复支付。")}
                    </p>
                )}
                {status === 0 && (
                    <section className="checkout-payment">
                        {(!compact ||
                            (paymentCurrency &&
                                paymentCurrency !== order.currency &&
                                paymentAmount != null)) && (
                            <div
                                className="checkout-amount"
                                aria-live="polite"
                                aria-atomic="true"
                            >
                                {!compact && (
                                    <>
                                        <span>{tx("应付金额")}</span>
                                        <strong>
                                            {feeReady ? money(due + fee) : "—"}
                                        </strong>
                                    </>
                                )}
                                {paymentCurrency &&
                                    paymentCurrency !== order.currency &&
                                    paymentAmount != null && (
                                        <div
                                            className="checkout-conversion"
                                            role="note"
                                        >
                                            <strong>
                                                {tx("实际付款")}{" "}
                                                {formatMoney(
                                                    paymentAmount,
                                                    paymentCurrency,
                                                )}
                                            </strong>
                                            <p>
                                                {tx(
                                                    "订单与余额币种保持不变，付款金额按确认时的汇率锁定。",
                                                )}
                                            </p>
                                            <a
                                                href="https://www.exchangerate-api.com"
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                Rates By Exchange Rate API
                                            </a>
                                        </div>
                                    )}
                            </div>
                        )}
                        {compact ? (
                            !awaitingConfirmation &&
                            !busy && (
                                <h3>
                                    {tx(due > 0 ? "选择支付方式" : "确认开通")}
                                </h3>
                            )
                        ) : (
                            <h2>{tx(due > 0 ? "选择支付方式" : "确认开通")}</h2>
                        )}
                        {due <= 0 && (
                            <p className="muted">
                                {tx("无需外部付款，确认后将处理订单。")}
                            </p>
                        )}
                        {due > 0 && (!compact || !awaitingConfirmation) && (
                            <p className="checkout-guidance">
                                {e("paymentReturn")}
                            </p>
                        )}
                        {error && (
                            <div className="alert" role="alert">
                                {error}
                            </div>
                        )}
                        {compact && (awaitingConfirmation || busy)
                            ? method && (
                                  <div className="checkout-method-confirmed">
                                      <PaymentIcon
                                          source={
                                              method.icon || method.asset_icon
                                          }
                                      />
                                      <span>
                                          <strong>{method.name}</strong>
                                          {method.category === "crypto" && (
                                              <small>
                                                  {method.asset} ·{" "}
                                                  {method.network_name ||
                                                      method.network}
                                              </small>
                                          )}
                                      </span>
                                  </div>
                              )
                            : due > 0 && (
                                  <State
                                      {...methods}
                                      loading={
                                          compact ? false : methods.loading
                                      }
                                      retry={methods.reload}
                                  >
                                      {compact && methods.loading && (
                                          <p
                                              role="status"
                                              className="checkout-quote-status muted"
                                          >
                                              {tx("正在加载…")}
                                          </p>
                                      )}
                                      <PaymentMethodPicker
                                          methods={methods.data || []}
                                          selected={selected}
                                          disabled={
                                              busy || awaitingConfirmation
                                          }
                                          onSelect={(id) => {
                                              setSelected(id);
                                              setQr("");
                                              setWaiting(false);
                                              setError("");
                                          }}
                                      />
                                      {!methods.loading &&
                                          !methods.data?.length && (
                                              <p className="muted">
                                                  {tx(
                                                      "暂无可用支付方式，请联系客服。",
                                                  )}
                                              </p>
                                          )}
                                  </State>
                              )}
                        {openUrl && awaitingConfirmation && (
                            <div
                                ref={paymentActionPanel}
                                className="checkout-open-payment"
                            >
                                <a
                                    className="button primary checkout-open-link"
                                    href={openUrl}
                                    rel="noreferrer"
                                    onClick={() => {
                                        trackAction("payment_open", "payment");
                                        setPollRun((run) => run + 1);
                                    }}
                                >
                                    {pc("openPayment")}
                                </a>
                                <p>{pc("openPaymentHelp")}</p>
                            </div>
                        )}
                        {smallScreen && openUrl && qr ? (
                            <details
                                className="checkout-alternative-qr"
                                onToggle={(event) => {
                                    if (!event.currentTarget.open) return;
                                    const target =
                                        qrPanel.current?.querySelector("svg");
                                    if (!target) return;
                                    const bounds =
                                        target.getBoundingClientRect();
                                    if (
                                        bounds.top >= 80 &&
                                        bounds.bottom <= window.innerHeight - 80
                                    )
                                        return;
                                    target.scrollIntoView?.({
                                        block: "center",
                                        behavior: window.matchMedia?.(
                                            "(prefers-reduced-motion: reduce)",
                                        )?.matches
                                            ? "instant"
                                            : "smooth",
                                    });
                                }}
                            >
                                <summary>{pc("paymentQrFallback")}</summary>
                                {qrContent}
                            </details>
                        ) : (
                            qrContent
                        )}
                        {smallScreen && (qr || paymentLink) && (
                            <div className="checkout-mobile-copy">
                                <button type="button" onClick={copyPayment}>
                                    {pc("copyPayment")}
                                </button>
                                <p role="status" aria-live="polite">
                                    {copied ? pc("paymentCopied") : "\u00a0"}
                                </p>
                                {copyError && (
                                    <p
                                        role="alert"
                                        className="checkout-copy-error"
                                    >
                                        {copyError}
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="checkout-confirm">
                            <button
                                type="button"
                                className={
                                    openUrl && awaitingConfirmation
                                        ? "checkout-check-result"
                                        : "primary"
                                }
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
                                {busy && (
                                    <LoaderCircle
                                        className="checkout-spinner"
                                        size={18}
                                        aria-hidden="true"
                                    />
                                )}
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
                        {due > 0 && <BrowserHandoffHelp context="payment" disabled={busy} />}
                        {compact ? (
                            <details className="checkout-order-actions">
                                <summary>{tx("订单信息")}</summary>
                                {secondaryActions}
                            </details>
                        ) : (
                            secondaryActions
                        )}
                    </section>
                )}
            </div>
            {pollStopped && (
                <div className="alert" role="status">
                    {tx("自动检查已暂停，订单仍可继续处理，请勿重复付款。")}
                    <button
                        type="button"
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
                    <button type="button" onClick={reload}>
                        {tx("检查支付结果")}
                    </button>
                </div>
            )}
            {status === 1 && (
                <div className="checkout-processing-actions">
                    <button type="button" onClick={reload}>
                        {tx("检查支付结果")}
                    </button>
                    <OrderHelp tradeNo={String(order.trade_no)} />
                </div>
            )}
            {retryOpen && status === 0 && (
                <Modal
                    title={tx("重新发起支付")}
                    close={() => {
                        if (!busy) setRetryOpen(false);
                    }}
                >
                    <div className="pad">
                        <p>{e("retryPayment")}</p>
                        <div className="actions">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    setRetryOpen(false);
                                    reload();
                                }}
                            >
                                {tx("检查支付结果")}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void restartPayment()}
                            >
                                {tx(busy ? "提交中…" : "重新发起支付")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
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
                                type="button"
                                disabled={busy}
                                onClick={() => setCancelOpen(false)}
                            >
                                {tx("继续支付")}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={cancel}
                            >
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
                        {renderCard(cardMethod, (token) => {
                            if (activeCardSession.current !== cardSession)
                                return Promise.resolve();
                            return pay(cardMethod, token);
                        })}
                    </div>
                </Modal>
            )}
        </div>
    );
}
