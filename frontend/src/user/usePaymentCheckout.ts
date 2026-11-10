import { useEffect, useMemo, useRef, useState } from "react";
import { query, request } from "../shared/api";
import { useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { paymentFee } from "./billing-flow";
import { nativeWechatQr, paymentActionUrl, qrPaymentActionUrl } from "./payment-action";
import { pricingCopy as pc } from "./pricing-copy";

type PaymentNumber = number | string | null;

// The V10 adapter still exposes the existing console field names. Keep the
// fields that govern payment identity, amount and state explicit at that edge.
export type CheckoutOrder = {
    trade_no?: string | null;
    status?: PaymentNumber;
    plan_id?: PaymentNumber;
    total_amount?: PaymentNumber;
    currency?: string | null;
    payment_id?: PaymentNumber;
    payment_amount?: PaymentNumber;
    payment_currency?: string | null;
    handling_amount?: PaymentNumber;
};

type CheckoutPaymentMethod = {
    id: number | string;
    name?: string;
    payment?: string;
    category?: string;
    asset?: string;
    icon?: string;
    asset_icon?: string;
    network?: string;
    network_name?: string;
    handling_fee_fixed?: PaymentNumber;
    handling_fee_percent?: PaymentNumber;
    quoted_amount?: PaymentNumber;
    quoted_currency?: string | null;
    quoted_fee?: PaymentNumber;
};

export type PaymentQuote = { amount: number; currency: string; fee: number };
export type InitialPayment = {
    methodId: number;
    amount: number;
    currency: string;
    requestKey: string;
};

type PaymentSubmission = {
    trade_no: CheckoutOrder["trade_no"];
    method: number;
    expected_payment_amount?: PaymentNumber;
    expected_payment_currency?: string | null;
    token?: string;
    switch_from_payment_method?: number;
    payment_request_key: string;
};
type IssuedQuote = { amount: CheckoutOrder["payment_amount"]; currency: CheckoutOrder["payment_currency"] };
type UnconfirmedPayment = { submission: PaymentSubmission; gatewayRejected: boolean };
type PaymentEntry = { kind: "qr" | "link"; value: string };
type RestoreState = { kind: "pending"; retries: number } | { kind: "unavailable" };
type OrderPaymentStatus = 0 | 1 | 2 | 3 | 4;
type PaymentView = {
    tradeNo: CheckoutOrder["trade_no"];
    status: OrderPaymentStatus | -1;
    selected: number;
    issuedMethod: number;
    snapshot: string;
};

const MAX_AUTOMATIC_RESTORE_RETRIES = 4;

function paymentOrderStatus(value: unknown): OrderPaymentStatus | undefined {
    const status = Number(value);
    switch (status) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
            return status;
    }
}

function paymentEntryFromResponse(type: unknown, value: unknown): PaymentEntry | undefined {
    if ((type !== 0 && type !== 1) || typeof value !== "string" || !value) {
        throw Object.assign(new Error("Invalid payment action"), { code: "RESPONSE_INVALID" });
    }
    if (type === 0) return { kind: "qr", value };
    const link = paymentActionUrl(value);
    if (link) return { kind: "link", value: link };
    // Native WeChat QR data is scan-only; it is not an H5 payment URL.
    if (nativeWechatQr(value)) return { kind: "qr", value };
}

export function usePaymentCheckout({ order, reload, initialPayment, smallScreen, onQuoteChange }: {
    order: CheckoutOrder;
    reload: () => void;
    initialPayment?: InitialPayment;
    smallScreen: boolean;
    onQuoteChange?: (quote: PaymentQuote | undefined) => void;
}) {
    const status = paymentOrderStatus(order.status) ?? -1;
    const [statusRefreshPending, setStatusRefreshPending] = useState(false);
    const [checkedPending, setCheckedPending] = useState(false);
    useEffect(() => {
        setStatusRefreshPending(false);
        setCheckedPending(false);
    }, [order.trade_no, status]);
    const deposit = Number(order.plan_id) === 0;
    const due = Number(order.total_amount || 0);
    const methods = useData<CheckoutPaymentMethod[]>(
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
    const [unavailableMethods, setUnavailableMethods] = useState<number[]>([]);
    const reconsiderMethods = useRef<{ data: CheckoutPaymentMethod[] | null; tradeNo: CheckoutOrder["trade_no"] } | undefined>(undefined);
    useEffect(() => {
        setUnavailableMethods((ids) => ids.length ? [] : ids);
        reconsiderMethods.current = undefined;
    }, [order.trade_no]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [paymentEntry, setPaymentEntry] = useState<PaymentEntry>();
    const qr = paymentEntry?.kind === "qr" ? paymentEntry.value : "";
    const paymentLink = paymentEntry?.kind === "link" ? paymentEntry.value : "";
    const [waiting, setWaiting] = useState(
        due > 0 && Boolean(order.payment_id),
    );
    const [unconfirmedPayment, setUnconfirmedPayment] = useState<UnconfirmedPayment>();
    const [confirmationPending, setConfirmationPending] = useState(false);
    const [checkingOnly, setCheckingOnly] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [restoreState, setRestoreState] = useState<RestoreState>();
    const pendingRestoreRetries = restoreState?.kind === "pending" ? restoreState.retries : undefined;
    const restoreUnavailable = restoreState?.kind === "unavailable";
    const [issuedFee, setIssuedFee] = useState(
        Number(order.handling_amount || 0),
    );
    const [issuedQuote, setIssuedQuote] = useState<IssuedQuote>({
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
    const [checkingPayment, setCheckingPayment] = useState(false);
    const recoverOnReturn = useRef<() => boolean>(() => false);
    const paymentBusy = busy || checkingPayment;
    const inFlight = useRef(false);
    const autoStarted = useRef(false);
    const paymentKey = useRef(
        initialPayment?.requestKey || crypto.randomUUID(),
    );
    const keyedMethod = useRef(initialPayment?.methodId);
    const restartFromMethod = useRef<number | undefined>(undefined);
    const refresh = useRef(reload);
    refresh.current = reload;
    const issuedMethod = Number(order.payment_id) || 0;
    const serverPayment = JSON.stringify([
        order.payment_id,
        order.payment_amount,
        order.payment_currency,
        order.handling_amount,
    ]);
    const observedPayment = useRef(serverPayment);
    const newServerPayment =
        Boolean(order.payment_id) && observedPayment.current !== serverPayment;
    const paymentView = useMemo<PaymentView>(() => ({
        tradeNo: order.trade_no,
        status: statusRefreshPending ? -1 : status,
        selected,
        issuedMethod,
        snapshot: serverPayment,
    }), [order.trade_no, status, statusRefreshPending, selected, issuedMethod, serverPayment]);
    const currentPaymentView = useRef(paymentView);
    currentPaymentView.current = paymentView;
    const attemptedRestore = useRef("");
    const restoreKey = JSON.stringify([order.trade_no, serverPayment, pollRun]);
    useEffect(() => {
        observedPayment.current = serverPayment;
        if (!newServerPayment || status !== 0) return;
        const channelChanged = issuedMethod !== selected;
        setSelected(issuedMethod);
        setIssuedFee(Number(order.handling_amount || 0));
        setIssuedQuote({
            amount: order.payment_amount,
            currency: order.payment_currency,
        });
        setWaiting(true);
        setCardMethod(null);
        setRestoreState(undefined);
        if (channelChanged) {
            setUnconfirmedPayment(undefined);
            setCheckingOnly(false);
            setConfirmationPending(false);
        }
        if (
            channelChanged ||
            (order.payment_amount != null &&
                Number(order.payment_amount) !== Number(issuedQuote.amount)) ||
            (order.payment_currency &&
                order.payment_currency !== issuedQuote.currency)
        ) {
            setPaymentEntry(undefined);
        }
    }, [serverPayment, status]);
    const method = methods.data?.find((item) => Number(item.id) === selected);
    const resumableMethod = restartFromMethod.current;
    // A failed preflight must not keep offering the same new payment. Retain
    // the previously issued channel only for its existing read-only recovery.
    const selectableMethods = useMemo(() => methods.data?.filter((item) =>
        !unavailableMethods.includes(Number(item.id)) || Number(item.id) === resumableMethod,
    ), [methods.data, unavailableMethods, resumableMethod]);
    useEffect(() => {
        const refresh = reconsiderMethods.current;
        if (!refresh || refresh.tradeNo !== order.trade_no || methods.loading) return;
        if (methods.error) reconsiderMethods.current = undefined;
        else if (methods.data && methods.data !== refresh.data) {
            reconsiderMethods.current = undefined;
            setUnavailableMethods([]);
            setError("");
        }
    }, [methods.data, methods.loading, methods.error, order.trade_no]);
    function refreshMethods() {
        if (methods.loading || methods.retryAt > Date.now()) return;
        if (unavailableMethods.length) {
            reconsiderMethods.current = { data: methods.data, tradeNo: order.trade_no };
            if (!waiting) setSelected(0);
        }
        methods.reload();
    }
    const openUrl =
        status === 0
            ? paymentLink ||
              (smallScreen && qr
                  ? qrPaymentActionUrl(qr, String(method?.payment || ""))
                  : undefined)
            : undefined;
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
    const canRestorePayment = status === 0 && !statusRefreshPending && awaitingConfirmation && !hasPaymentAction &&
        !checkingOnly && !unconfirmedPayment?.gatewayRejected &&
        selected === Number(order.payment_id) && Boolean(method);
    const originalSubmission = unconfirmedPayment && !unconfirmedPayment.gatewayRejected &&
        (unconfirmedPayment.submission.method === 0 ||
            (unconfirmedPayment.submission.method === selected && Boolean(method)))
        ? unconfirmedPayment.submission
        : undefined;
    const restorePending = pendingRestoreRetries !== undefined;
    const retrySubmission = awaitingConfirmation && !hasPaymentAction && !confirmationPending && !restorePending
        ? originalSubmission
        : undefined;
    const canSwitchPayment = awaitingConfirmation && (!checkingOnly || Boolean(unconfirmedPayment)) &&
        (Boolean(methods.error) || selectableMethods?.some((item) => Number(item.id) !== selected));
    const showRecoveryHelp = awaitingConfirmation && !hasPaymentAction &&
        (confirmationPending || restorePending || restoreUnavailable || unconfirmedPayment?.gatewayRejected);
    const selectedOriginalMethod = restartFromMethod.current === selected || Boolean(originalSubmission);
    const confirmLabel = restoring || checkingPayment
        ? tx("正在加载…")
        : awaitingConfirmation
          ? pc("checkPayment")
          : busy
            ? tx("提交中…")
            : selectedOriginalMethod
              ? pc(originalSubmission ? "retryPaymentRequest" : "paymentOpenAgain")
              : tx(due > 0 ? "确认支付" : "确认开通");
    let paymentStatusMessage = "";
    if (awaitingConfirmation && !error && !restoring && !checkingPayment) {
        if (pollError) paymentStatusMessage = tx("订单状态暂不可用，请刷新后重试。");
        else if (pollStopped) paymentStatusMessage = tx("自动检查已暂停，订单仍可继续处理，请勿重复付款。");
        else if (confirmationPending && hasPaymentAction) paymentStatusMessage = pc("paymentSwitchUnchanged");
        else if (pendingRestoreRetries === MAX_AUTOMATIC_RESTORE_RETRIES) paymentStatusMessage = pc("paymentActionUnavailable");
        else if (confirmationPending || restorePending) paymentStatusMessage = pc("paymentConfirmationPending");
        else if (unconfirmedPayment?.gatewayRejected) paymentStatusMessage = pc("paymentGatewayRejected");
        else if (unconfirmedPayment) paymentStatusMessage = tx("未能确认支付请求结果，正在检查订单状态，请勿重复付款。");
        else if (!hasPaymentAction) {
            paymentStatusMessage = restoreUnavailable || (selected > 0 && methods.data && !method)
                ? pc("paymentActionUnavailable")
                : tx("正在等待支付确认，请勿重复付款。");
        }
        else if (checkedPending) paymentStatusMessage = pc("paymentNotConfirmed");
    }
    const paymentLocked = useRef(false);
    paymentLocked.current = awaitingConfirmation || status !== 0 || statusRefreshPending;
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
            selectableMethods?.length &&
            !selectableMethods.some((item) => Number(item.id) === selected)
        )
            setSelected(
                Number(
                    selectableMethods.find((item) => item.category !== "crypto")
                        ?.id ||
                        (selectableMethods.length === 1 ? selectableMethods[0].id : 0),
                ),
            );
    }, [selectableMethods, selected, waiting]);
    useEffect(() => {
        if (status !== 0 || statusRefreshPending) {
            setPaymentEntry(undefined);
            setCardMethod(null);
            setRetryOpen(false);
            setUnconfirmedPayment(undefined);
            setConfirmationPending(false);
            setRestoreState(undefined);
        }
    }, [status, statusRefreshPending]);
    function refreshChangedOrder(nextStatus: OrderPaymentStatus) {
        // Lock immediately, including responses arriving before React renders.
        currentPaymentView.current = { ...currentPaymentView.current, status: nextStatus };
        setStatusRefreshPending(true);
        refresh.current();
    }
    useEffect(() => {
        if (status !== 1 && !(status === 0 && waiting)) {
            setCheckingPayment(false);
            return;
        }
        setPollStopped(false);
        let live = true,
            checks = 0,
            checking = false,
            observedChange = false;
        let manualCheck = checkingPayment;
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
            const manual = manualCheck;
            manualCheck = false;
            let stillPending = false;
            try {
                const result = await request<number>(
                    query("user/order/check", { trade_no: order.trade_no }),
                    undefined,
                    { signal: controller.signal },
                );
                if (!live) return;
                const nextStatus = paymentOrderStatus(result.data);
                if (nextStatus === undefined) {
                    throw new Error("Invalid order status");
                }
                setPollError("");
                if (nextStatus !== status) {
                    observedChange = true;
                    refreshChangedOrder(nextStatus);
                    window.dispatchEvent(new Event("data-changed"));
                } else if (manual) {
                    stillPending = status === 0;
                    setCheckedPending(stillPending);
                    refresh.current();
                }
            } catch (problem) {
                if (live) setPollError((problem as Error).message);
            } finally {
                checking = false;
                if (live && manual) {
                    if (!stillPending) {
                        // An unsuccessful status check cannot authorize a new recovery read.
                        attemptedRestore.current = restoreKey;
                        setRestoreState(undefined);
                    }
                    setCheckingPayment(false);
                }
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
            if (document.visibilityState !== "hidden" && !recoverOnReturn.current()) void check();
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
        if (inFlight.current || currentPaymentView.current.status !== 0 || (!retry && paymentLocked.current) || !mounted.current || unavailableMethods.includes(id))
            return;
        const started = currentPaymentView.current;
        const stillCurrent = () => {
            const current = currentPaymentView.current;
            // The order may refresh as this request binds its own channel.
            return mounted.current && current.tradeNo === started.tradeNo && current.status === 0 &&
                (id === 0 ? current.selected === started.selected : current.selected === id) &&
                (current.issuedMethod === started.issuedMethod || current.issuedMethod === id);
        };
        inFlight.current = true;
        if (!retry && keyedMethod.current !== id) {
            paymentKey.current = crypto.randomUUID();
            keyedMethod.current = id;
        }
        if (!retry) setUnconfirmedPayment(undefined);
        setBusy(true);
        setError("");
        setCheckedPending(false);
        setRestoreState(undefined);
        setConfirmationPending(false);
        const quotedMethod = methods.data?.find((item) => Number(item.id) === id);
        const previousMethod = restartFromMethod.current;
        const submission: PaymentSubmission = retry ?? {
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
        const checkoutQuote: IssuedQuote = retry ? issuedQuote : {
            amount: quotedMethod?.quoted_amount,
            currency: quotedMethod?.quoted_currency,
        };
        try {
            const result = await request(
                "user/order/checkout",
                submission,
                { timeoutMs: 45000 },
            );
            if (!stillCurrent()) return;
            restartFromMethod.current = undefined;
            setIssuedFee(checkoutFee);
            setIssuedQuote(checkoutQuote);
            if (result.type !== 2) setUnconfirmedPayment(undefined);
            setCheckingOnly(result.type === -1 || (result.type === 2 && !retry));
            if (result.type === -1 || result.type === 2) {
                setWaiting(true);
                setCardMethod(null);
                refreshPaymentOrder();
            } else {
                const entry = paymentEntryFromResponse(result.type, result.data);
                setPaymentEntry(entry);
                setWaiting(true);
                setCardMethod(null);
                if (!entry) {
                    setError(tx("此支付方式需要专用客户端，请选择其他方式。"));
                }
            }
        } catch (problem) {
            if (!stillCurrent()) return;
            const failure = problem as Error & {
                code?: string;
                status?: number;
            };
            if (failure.code === "PAYMENT_CONFIRMATION_PENDING") {
                const currentMethod = currentPaymentView.current.issuedMethod;
                const linkedMethod = currentMethod !== started.issuedMethod
                    ? currentMethod
                    : previousMethod || currentMethod;
                if (linkedMethod) setSelected(linkedMethod);
                setIssuedFee(Number(order.handling_amount || 0));
                setIssuedQuote({ amount: order.payment_amount, currency: order.payment_currency });
                setUnconfirmedPayment(undefined);
                setConfirmationPending(true);
                setWaiting(true);
                refreshPaymentOrder();
                return;
            }
            if (failure.status === 409) {
                if (retry) {
                    try {
                        const { data } = await request<CheckoutOrder>(
                            query("user/order/detail", { trade_no: order.trade_no }),
                        );
                        if (!stillCurrent()) return;
                        if (paymentOrderStatus(data?.status) === 0 && !data?.payment_id) {
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
                refreshPaymentOrder();
            } else if (failure.code === "PAYMENT_CHANNEL_UNAVAILABLE") {
                setError(pc("paymentChannelUnavailable"));
                setUnavailableMethods((ids) => ids.includes(id) ? ids : [...ids, id]);
                restartFromMethod.current = previousMethod || currentPaymentView.current.issuedMethod || undefined;
                setSelected(0);
                setUnconfirmedPayment(undefined);
                setWaiting(false);
                setCheckingOnly(false);
                setCardMethod(null);
                methods.reload();
                reload();
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
            setPaymentEntry(undefined);
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
        const view = currentPaymentView.current;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await request<CheckoutOrder>(
                query("user/order/detail", { trade_no: order.trade_no }),
            );
            if (!mounted.current || currentPaymentView.current !== view) return;
            const nextStatus = paymentOrderStatus(result.data?.status);
            if (nextStatus === undefined) {
                throw new Error(tx("订单状态暂不可用，请刷新后重试。"));
            }
            if (nextStatus === 0) {
                autoStarted.current = true;
                const previousMethod = Number(result.data.payment_id) || undefined;
                restartFromMethod.current = previousMethod;
                setSelected(0);
                setWaiting(false);
                setUnconfirmedPayment((payment) =>
                    !previousMethod || payment?.submission.method === previousMethod ? payment : undefined,
                );
                setCheckingOnly(false);
                setConfirmationPending(false);
                setRestoreState(undefined);
                setPollError("");
                setPollStopped(false);
                setPaymentEntry(undefined);
                paymentKey.current = crypto.randomUUID();
                methods.reload();
            } else refreshChangedOrder(nextStatus);
        } catch (problem) {
            if (mounted.current && currentPaymentView.current === view) setError((problem as Error).message);
        } finally {
            inFlight.current = false;
            if (mounted.current) {
                setRetryOpen(false);
                setBusy(false);
            }
        }
    }
    async function resumePayment(id: number, mode: "manual" | "initial" | "background" = "manual") {
        if (inFlight.current || currentPaymentView.current.status !== 0 || id <= 0) return;
        inFlight.current = true;
        const retryCount = mode === "background" ? (pendingRestoreRetries ?? 0) + 1 : 0;
        attemptedRestore.current = restoreKey;
        const view = currentPaymentView.current;
        setBusy(true);
        setRestoring(mode !== "background");
        if (mode === "manual") setError("");
        try {
            const result = await request("user/order/checkout", {
                trade_no: order.trade_no,
                method: id,
                resume_payment: true,
            }, { timeoutMs: 8000 });
            if (!mounted.current || currentPaymentView.current !== view) return;
            setRestoreState(undefined);
            if (result.type === 2) {
                setWaiting(true);
                setCheckingOnly(true);
                setUnconfirmedPayment(undefined);
                setConfirmationPending(false);
                refreshPaymentOrder();
                return;
            }
            const entry = paymentEntryFromResponse(result.type, result.data);
            if (!entry) throw new Error("Unsupported payment entry");
            setPaymentEntry(entry);
            setWaiting(true);
            setUnconfirmedPayment(undefined);
            setError("");
            restartFromMethod.current = undefined;
        } catch (problem) {
            if (!mounted.current || currentPaymentView.current !== view) return;
            setWaiting(true);
            const code = (problem as { code?: string }).code;
            setRestoreState(code === "PAYMENT_CONFIRMATION_PENDING"
                ? { kind: "pending", retries: retryCount }
                : { kind: "unavailable" });
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
        if (!canRestorePayment || paymentBusy || retryOpen || cancelOpen || inFlight.current || document.visibilityState === "hidden") return;
        if (attemptedRestore.current !== restoreKey) {
            void resumePayment(selected, "initial");
            return;
        }
        if (pendingRestoreRetries === undefined || pendingRestoreRetries >= MAX_AUTOMATIC_RESTORE_RETRIES) return;
        // The provider can save a QR while the order is still awaiting payment.
        const timer = setTimeout(() => {
            if (inFlight.current || document.visibilityState === "hidden") return;
            void resumePayment(selected, "background");
        }, 5000);
        return () => clearTimeout(timer);
    }, [canRestorePayment, paymentBusy, retryOpen, cancelOpen, pendingRestoreRetries, restoreKey, selected]);
    function refreshPaymentOrder() {
        setPollError("");
        setPollStopped(false);
        setPollRun((run) => run + 1);
        reload();
    }
    function checkPayment() {
        if (paymentBusy || inFlight.current) return;
        setPollError("");
        setPollStopped(false);
        setCheckedPending(false);
        if (methods.error) methods.reload();
        setCheckingPayment(true);
        setPollRun((run) => run + 1);
    }
    recoverOnReturn.current = () => {
        if (!canRestorePayment || paymentBusy || inFlight.current || retryOpen || cancelOpen) return false;
        checkPayment();
        return true;
    };
    function confirmOrCheckPayment() {
        if (awaitingConfirmation) checkPayment();
        else if (selectedOriginalMethod) {
            if (originalSubmission) void pay(originalSubmission.method, undefined, originalSubmission);
            else void resumePayment(selected);
        }
        else if (due > 0 && method?.payment === "StripeCredit") {
            setCardMethod(Number(method.id));
        } else void pay(due > 0 ? selected : 0);
    }
    function selectPaymentMethod(id: number) {
        setSelected(id);
        setPaymentEntry(undefined);
        setWaiting(false);
        setError("");
    }
    function retryPayment() {
        if (retrySubmission) void pay(retrySubmission.method, undefined, retrySubmission);
    }
    function submitCardPayment(token: string) {
        if (cardMethod == null || activeCardSession.current !== cardSession) return Promise.resolve();
        return pay(cardMethod, token);
    }
    function closeCardPayment() {
        setCardMethod(null);
    }
    function paymentOpened() {
        setPollRun((run) => run + 1);
    }
    return {
        status, statusRefreshPending, deposit, due, fee, feeReady, paymentAmount, paymentCurrency,
        methods, method, selectableMethods, selected, refreshMethods, selectPaymentMethod,
        hasUnavailableMethods: unavailableMethods.length > 0,
        busy, paymentBusy, waiting, awaitingConfirmation, error, qr, paymentLink, openUrl,
        confirmLabel, paymentStatusMessage, confirmOrCheckPayment, checkPayment, checkingPayment,
        restoring, pollError, pollStopped, canSwitchPayment, showRecoveryHelp,
        canRetrySubmission: Boolean(retrySubmission), retryPayment, paymentOpened,
        retryOpen, setRetryOpen, choosePaymentMethod, cancelOpen, setCancelOpen, cancel,
        cardMethod, submitCardPayment, closeCardPayment,
    };
}
