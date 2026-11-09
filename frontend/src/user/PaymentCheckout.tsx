import { trackCopyFailure, useAnalyticsPage } from "./product-analytics";
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
type PaymentSubmission = Row & { method: number };
type UnconfirmedPayment = { submission: PaymentSubmission; gatewayRejected: boolean };

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
    const [unconfirmedPayment, setUnconfirmedPayment] = useState<UnconfirmedPayment>();
    const [confirmationPending, setConfirmationPending] = useState(false);
    const [checkingOnly, setCheckingOnly] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [restorePending, setRestorePending] = useState(false);
    const [restoreUnavailable, setRestoreUnavailable] = useState(false);
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
    const restartFromMethod = useRef<number | undefined>(undefined);
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
    const paymentView = JSON.stringify([order.trade_no, status, selected, serverPayment]);
    const currentPaymentView = useRef(paymentView);
    currentPaymentView.current = paymentView;
    const attemptedRestore = useRef("");
    const restoreRetries = useRef(0);
    useEffect(() => {
        observedPayment.current = serverPayment;
        if (!newServerPayment || status !== 0) return;
        const issuedMethod = Number(order.payment_id);
        const channelChanged = issuedMethod !== selected;
        setSelected(issuedMethod);
        setIssuedFee(Number(order.handling_amount || 0));
        setIssuedQuote({
            amount: order.payment_amount,
            currency: order.payment_currency,
        });
        setWaiting(true);
        setCardMethod(null);
        setRestorePending(false);
        setRestoreUnavailable(false);
        if (channelChanged) {
            setUnconfirmedPayment(undefined);
            setCheckingOnly(false);
        }
        if (
            channelChanged ||
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
        if (!embedded || !smallScreen || !openUrl || !paymentActionPanel.current) return;
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
    }, [embedded, smallScreen, openUrl]);
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
    const hasPaymentAction = Boolean(qr || openUrl);
    const canRestorePayment = status === 0 && awaitingConfirmation && !hasPaymentAction &&
        !checkingOnly && !unconfirmedPayment?.gatewayRejected &&
        selected === Number(order.payment_id) && Boolean(method);
    const originalSubmission = unconfirmedPayment && !unconfirmedPayment.gatewayRejected &&
        (unconfirmedPayment.submission.method === 0 ||
            (unconfirmedPayment.submission.method === selected && Boolean(method)))
        ? unconfirmedPayment.submission
        : undefined;
    const retrySubmission = awaitingConfirmation && !hasPaymentAction && !confirmationPending && !restorePending
        ? originalSubmission
        : undefined;
    const canSwitchPayment = awaitingConfirmation && (!checkingOnly || Boolean(unconfirmedPayment)) &&
        (Boolean(methods.error) || methods.data?.some((item) => Number(item.id) !== selected));
    const showRecoveryHelp = awaitingConfirmation && !hasPaymentAction &&
        (confirmationPending || restorePending || restoreUnavailable);
    const canReopenPayment = canRestorePayment && showRecoveryHelp && !retrySubmission;
    const selectedOriginalMethod = restartFromMethod.current === selected || Boolean(originalSubmission);
    const confirmLabel = restoring
        ? tx("正在加载…")
        : awaitingConfirmation
          ? tx("检查支付结果")
          : busy
            ? tx("提交中…")
            : selectedOriginalMethod
              ? pc(originalSubmission ? "retryPaymentRequest" : "paymentOpenAgain")
              : tx(due > 0 ? "确认支付" : "确认开通");
    let paymentStatusMessage = "";
    if (awaitingConfirmation && !error && !restoring) {
        if (pollError) paymentStatusMessage = tx("订单状态暂不可用，请刷新后重试。");
        else if (pollStopped) paymentStatusMessage = tx("自动检查已暂停，订单仍可继续处理，请勿重复付款。");
        else if (confirmationPending || restorePending) paymentStatusMessage = pc("paymentConfirmationPending");
        else if (unconfirmedPayment?.gatewayRejected) paymentStatusMessage = pc("paymentGatewayRejected");
        else if (unconfirmedPayment) paymentStatusMessage = tx("未能确认支付请求结果，正在检查订单状态，请勿重复付款。");
        else if (!hasPaymentAction) {
            paymentStatusMessage = restoreUnavailable || (selected > 0 && methods.data && !method)
                ? pc("paymentActionUnavailable")
                : tx("正在等待支付确认，请勿重复付款。");
        }
    }
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
            setUnconfirmedPayment(undefined);
            setConfirmationPending(false);
            setRestorePending(false);
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
    async function pay(id: number, token?: string, retry?: PaymentSubmission) {
        if (inFlight.current || status !== 0 || (!retry && paymentLocked.current) || !mounted.current)
            return;
        inFlight.current = true;
        if (!retry && keyedMethod.current !== id) {
            paymentKey.current = crypto.randomUUID();
            keyedMethod.current = id;
        }
        if (!retry) setUnconfirmedPayment(undefined);
        setBusy(true);
        setError("");
        setRestorePending(false);
        setRestoreUnavailable(false);
        setConfirmationPending(false);
        const quotedMethod = methods.data?.find((item) => Number(item.id) === id);
        const previousMethod = restartFromMethod.current;
        const submission = retry ?? {
            trade_no: order.trade_no,
            method: id,
            expected_payment_amount: quotedMethod?.quoted_amount,
            expected_payment_currency: quotedMethod?.quoted_currency,
            ...(token ? { token } : {}),
            ...(previousMethod && previousMethod !== id && id > 0
                ? { switch_from_payment_method: previousMethod }
                : {}),
            payment_request_key: paymentKey.current,
        };
        const checkoutFee = retry ? issuedFee : Number(quotedMethod?.quoted_fee ?? paymentFee(due, quotedMethod));
        const checkoutQuote = retry ? issuedQuote : {
            amount: quotedMethod?.quoted_amount,
            currency: quotedMethod?.quoted_currency,
        };
        try {
            const result = await request(
                "user/order/checkout",
                submission,
                { timeoutMs: 45000 },
            );
            if (!mounted.current) return;
            restartFromMethod.current = undefined;
            setIssuedFee(checkoutFee);
            setIssuedQuote(checkoutQuote);
            if (result.type !== 2) setUnconfirmedPayment(undefined);
            setCheckingOnly(result.type === -1 || (result.type === 2 && !retry));
            if (result.type === -1 || result.type === 2) {
                setWaiting(true);
                setCardMethod(null);
                checkPaymentResult();
            } else if (result.type === 1 && typeof result.data === "string" && result.data) {
                const action = paymentActionUrl(result.data);
                setWaiting(true);
                setCardMethod(null);
                if (action) {
                    setPaymentLink(action);
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
            } else throw Object.assign(new Error("Invalid payment action"), { code: "RESPONSE_INVALID" });
        } catch (problem) {
            if (!mounted.current) return;
            const failure = problem as Error & {
                code?: string;
                status?: number;
            };
            if (failure.code === "PAYMENT_CONFIRMATION_PENDING") {
                const linkedMethod = previousMethod ?? (Number(order.payment_id) || undefined);
                if (linkedMethod) setSelected(linkedMethod);
                setIssuedFee(Number(order.handling_amount || 0));
                setIssuedQuote({ amount: order.payment_amount, currency: order.payment_currency });
                setUnconfirmedPayment(undefined);
                setConfirmationPending(true);
                setWaiting(true);
                checkPaymentResult();
                return;
            }
            if (failure.status === 409) {
                if (retry) {
                    try {
                        const { data } = await request<Row>(
                            query("user/order/detail", { trade_no: order.trade_no }),
                        );
                        if (!mounted.current) return;
                        if (Number(data?.status) === 0 && !data?.payment_id) {
                            setUnconfirmedPayment(undefined);
                            setWaiting(false);
                            setCheckingOnly(false);
                        }
                    } catch {
                        // Keep the original request if the order could not be checked.
                    }
                }
                methods.reload();
                reload();
            }
            if (
                ["NETWORK_ERROR", "REQUEST_TIMEOUT", "RESPONSE_INVALID", "PAYMENT_GATEWAY_REJECTED"].includes(
                    failure.code || "",
                ) ||
                (failure.status || 0) >= 500
            ) {
                setIssuedFee(checkoutFee);
                setIssuedQuote(checkoutQuote);
                setUnconfirmedPayment({
                    submission,
                    gatewayRejected: failure.code === "PAYMENT_GATEWAY_REJECTED",
                });
                setWaiting(true);
                checkPaymentResult();
            } else if (failure.code === "PAYMENT_CHANNEL_UNAVAILABLE") {
                setError(pc("paymentChannelUnavailable"));
                if (retry) {
                    setUnconfirmedPayment(undefined);
                    setWaiting(false);
                    setCheckingOnly(false);
                    reload();
                }
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
    async function choosePaymentMethod() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await request<Row>(
                query("user/order/detail", { trade_no: order.trade_no }),
            );
            if (Number(result.data?.status) === 0) {
                autoStarted.current = true;
                const previousMethod = Number(result.data.payment_id) || undefined;
                restartFromMethod.current = previousMethod;
                if (previousMethod) setSelected(previousMethod);
                setWaiting(false);
                setUnconfirmedPayment((payment) =>
                    !previousMethod || payment?.submission.method === previousMethod ? payment : undefined,
                );
                setCheckingOnly(false);
                setConfirmationPending(false);
                setRestorePending(false);
                setRestoreUnavailable(false);
                setPollError("");
                setPollStopped(false);
                setQr("");
                setPaymentLink("");
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
    async function resumePayment(id: number, mode: "manual" | "initial" | "background" = "manual") {
        if (inFlight.current || status !== 0 || id <= 0) return;
        inFlight.current = true;
        const key = JSON.stringify([order.trade_no, serverPayment, pollRun]);
        if (mode === "manual" || attemptedRestore.current !== key) restoreRetries.current = 0;
        attemptedRestore.current = key;
        const view = currentPaymentView.current;
        setBusy(true);
        setRestoring(mode !== "background");
        setRestoreUnavailable(false);
        if (mode === "manual") setError("");
        try {
            const result = await request("user/order/checkout", {
                trade_no: order.trade_no,
                method: id,
                resume_payment: true,
            }, { timeoutMs: 8000 });
            if (!mounted.current || currentPaymentView.current !== view) return;
            setRestorePending(false);
            if (result.type === 2) {
                setWaiting(true);
                setCheckingOnly(true);
                setUnconfirmedPayment(undefined);
                setConfirmationPending(false);
                checkPaymentResult();
                return;
            }
            if (typeof result.data !== "string" || !result.data) {
                throw new Error(tx("订单状态暂不可用，请刷新后重试。"));
            }
            const link = result.type === 1 ? paymentActionUrl(result.data) : undefined;
            if (link) setPaymentLink(link);
            else if (result.type === 0 || (result.type === 1 && nativeWechatQr(result.data))) {
                setQr(result.data);
            } else throw new Error(tx("此支付方式需要专用客户端，请选择其他方式。"));
            setWaiting(true);
            setUnconfirmedPayment(undefined);
            setConfirmationPending(false);
            setError("");
            restartFromMethod.current = undefined;
        } catch (problem) {
            if (!mounted.current || currentPaymentView.current !== view) return;
            setWaiting(true);
            const code = (problem as { code?: string }).code;
            setRestorePending(code === "PAYMENT_CONFIRMATION_PENDING");
            if (code !== "PAYMENT_CONFIRMATION_PENDING") setRestoreUnavailable(true);
            if (code === "PAYMENT_ACTION_UNAVAILABLE") setConfirmationPending(false);
        } finally {
            inFlight.current = false;
            if (mounted.current) {
                setBusy(false);
                setRestoring(false);
            }
        }
    }
    useEffect(() => {
        if (!canRestorePayment || busy || retryOpen || cancelOpen || inFlight.current) return;
        const key = JSON.stringify([order.trade_no, serverPayment, pollRun]);
        if (attemptedRestore.current !== key) {
            void resumePayment(selected, "initial");
            return;
        }
        if (!restorePending || restoreRetries.current >= 4) return;
        // The provider can save a QR while the order is still awaiting payment.
        const timer = setTimeout(() => {
            if (inFlight.current) return;
            restoreRetries.current++;
            void resumePayment(selected, "background");
        }, 5000);
        return () => clearTimeout(timer);
    }, [canRestorePayment, busy, retryOpen, cancelOpen, restorePending, order.trade_no, serverPayment, pollRun, selected]);
    function checkPaymentResult() {
        setPollError("");
        setPollStopped(false);
        setPollRun((run) => run + 1);
        reload();
    }
    function confirmOrCheckPayment() {
        if (awaitingConfirmation) checkPaymentResult();
        else if (selectedOriginalMethod) {
            if (originalSubmission) void pay(originalSubmission.method, undefined, originalSubmission);
            else void resumePayment(selected);
        }
        else if (due > 0 && method?.payment === "StripeCredit") {
            setCardMethod(Number(method.id));
        } else void pay(due > 0 ? selected : 0);
    }
    async function copyPayment() {
        setCopied(false);
        setCopyError("");
        try {
            await navigator.clipboard.writeText(qr || paymentLink);
            setCopied(true);
        } catch {
            trackCopyFailure("payment");
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
                {!showRecoveryHelp && <OrderHelp tradeNo={String(order.trade_no)} />}
                <div className="checkout-secondary-actions">
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
                        {openUrl && awaitingConfirmation && (
                            <p className="checkout-open-help">{pc("openPaymentHelp")}</p>
                        )}
                        <div className="checkout-confirm" ref={paymentActionPanel}>
                            {openUrl && awaitingConfirmation ? (
                                <a
                                    className="button primary checkout-open-link"
                                    href={busy ? undefined : openUrl}
                                    aria-disabled={busy || undefined}
                                    rel="noreferrer"
                                    onClick={() => setPollRun((run) => run + 1)}
                                >
                                    {pc("openPayment")}
                                </a>
                            ) : (
                                <button
                                    type="button"
                                    className="primary"
                                    disabled={
                                        busy ||
                                        (!awaitingConfirmation &&
                                            due > 0 &&
                                            (!method ||
                                                methods.loading ||
                                                Boolean(methods.error)))
                                    }
                                    onClick={confirmOrCheckPayment}
                                >
                                    {busy && (!awaitingConfirmation || restoring) && (
                                        <LoaderCircle
                                            className="checkout-spinner"
                                            size={18}
                                            aria-hidden="true"
                                        />
                                    )}
                                    {confirmLabel}
                                </button>
                            )}
                        </div>
                        {paymentStatusMessage && (
                            <p role="status" className="muted">
                                {paymentStatusMessage}
                            </p>
                        )}
                        {((openUrl && awaitingConfirmation) || canSwitchPayment || retrySubmission || showRecoveryHelp) && (
                            <div className="checkout-secondary">
                                <div className="checkout-secondary-actions">
                                    {openUrl && awaitingConfirmation && (
                                        <button
                                            type="button"
                                            className="checkout-check-result"
                                            disabled={busy}
                                            onClick={checkPaymentResult}
                                        >
                                            {tx("检查支付结果")}
                                        </button>
                                    )}
                                    {canSwitchPayment && (
                                        <button type="button" disabled={busy} onClick={() => setRetryOpen(true)}>
                                            {pc("reselectPayment")}
                                        </button>
                                    )}
                                    {canReopenPayment && (
                                        <button type="button" disabled={busy} onClick={() => void resumePayment(selected)}>
                                            {pc("paymentOpenAgain")}
                                        </button>
                                    )}
                                    {retrySubmission && (
                                        <button type="button" disabled={busy} onClick={() =>
                                            void pay(retrySubmission.method, undefined, retrySubmission)
                                        }>
                                            {pc("retryPaymentRequest")}
                                        </button>
                                    )}
                                </div>
                                {showRecoveryHelp && <OrderHelp tradeNo={String(order.trade_no)} />}
                            </div>
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
            {status === 1 && (
                <div className="checkout-processing-actions">
                    {(pollError || pollStopped) && (
                        <p role="status" className="muted">
                            {tx(pollError
                                ? "订单状态暂不可用，请刷新后重试。"
                                : "自动检查已暂停，订单仍可继续处理，请勿重复付款。")}
                        </p>
                    )}
                    <button type="button" onClick={checkPaymentResult}>
                        {tx(pollStopped ? "继续检查" : "检查支付结果")}
                    </button>
                    <OrderHelp tradeNo={String(order.trade_no)} />
                </div>
            )}
            {retryOpen && status === 0 && (
                <Modal
                    title={pc("reselectPayment")}
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
                                    checkPaymentResult();
                                }}
                            >
                                {tx("检查支付结果")}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void choosePaymentMethod()}
                            >
                                {tx(busy ? "正在加载…" : "继续")}
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
                                {tx("返回")}
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
