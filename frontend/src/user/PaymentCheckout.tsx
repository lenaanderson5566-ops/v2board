import { trackCopyFailure, useAnalyticsPage } from "./product-analytics";
import { OrderReceipt } from "./OrderReceipt";
import { OrderHelp } from "./OrderHelp";
import { BrowserHandoffHelp } from "./BrowserHandoffHelp";
import { PaymentIcon, PaymentMethodPicker } from "./PaymentMethodPicker";
import { c, minuteDate } from "../shared/credit-copy";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, LoaderCircle, ReceiptText } from "lucide-react";
import { bytes, money as formatMoney, type Row } from "../shared/api";
import { State, Modal } from "../shared/ui";
import { tx } from "../shared/i18n";
import { e } from "../shared/experience-copy";
import { billingPeriods, orderOriginalAmount } from "./billing-flow";
import { pricingCopy as pc } from "./pricing-copy";
import { PurchaseSteps } from "./PurchaseSteps";
import { usePaymentCheckout, type CheckoutOrder, type InitialPayment, type PaymentQuote } from "./usePaymentCheckout";

export type { InitialPayment, PaymentQuote } from "./usePaymentCheckout";

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
    order: Row & CheckoutOrder;
    reload: () => void;
    renderCard: (
        method: number,
        pay: (token: string) => Promise<void>,
    ) => ReactNode;
}) {
    const money = (amount: unknown) =>
        formatMoney(amount, order.currency || "CNY");
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [smallScreen, setSmallScreen] = useState(
        () => window.innerWidth <= 800,
    );
    useEffect(() => {
        const resize = () => setSmallScreen(window.innerWidth <= 800);
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    const {
        status, statusRefreshPending, deposit, due, fee, feeReady, paymentAmount, paymentCurrency,
        methods, method, selectableMethods, selected, refreshMethods, selectPaymentMethod,
        hasUnavailableMethods, busy, paymentBusy, waiting, awaitingConfirmation, error, qr, paymentLink, openUrl,
        confirmLabel, paymentStatusMessage, confirmOrCheckPayment, checkPayment, checkingPayment,
        restoring, pollError, pollStopped, canSwitchPayment, showRecoveryHelp,
        canRetrySubmission, retryPayment, paymentOpened, retryOpen, setRetryOpen, choosePaymentMethod,
        cancelOpen, setCancelOpen, cancel, cardMethod, submitCardPayment, closeCardPayment,
    } = usePaymentCheckout({ order, reload, initialPayment, smallScreen, onQuoteChange });
    useAnalyticsPage(
        status === 0 && !deposit && order.period !== "reset_price"
            ? "payment"
            : null,
    );
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState("");
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
                    {copied ? pc("paymentCopied") : tx("复制")}
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
                        disabled={paymentBusy}
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
            <QRCodeSVG value={qr} size={200} marginSize={3} role="img" title={tx("付款内容")} />
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
    if (statusRefreshPending)
        return (
            <div className={compact ? "checkout-inline" : "checkout-page"}>
                <p role="status">{pc("paymentStatusUpdating")}</p>
                <button type="button" onClick={reload}>{tx("刷新")}</button>
            </div>
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
                        {compact && awaitingConfirmation && methods.error && (
                            <div className="alert" role="alert">{methods.error}</div>
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
                                      retry={refreshMethods}
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
                                          methods={selectableMethods || []}
                                          selected={selected}
                                          disabled={
                                              busy || awaitingConfirmation
                                          }
                                          onSelect={selectPaymentMethod}
                                      />
                                      {!methods.loading &&
                                          !selectableMethods?.length && (
                                              <p className="muted">
                                                  {tx(
                                                      "暂无可用支付方式，请联系客服。",
                                                  )}
                                                  {hasUnavailableMethods && !methods.error && (
                                                      <button type="button" disabled={paymentBusy || methods.loading || methods.retryAt > Date.now()} onClick={refreshMethods}>
                                                          {tx("刷新")}
                                                      </button>
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
                                    href={paymentBusy ? undefined : openUrl}
                                    aria-disabled={paymentBusy || undefined}
                                    rel="noreferrer"
                                    onClick={paymentOpened}
                                >
                                    {pc("openPayment")}
                                </a>
                            ) : (
                                <button
                                    type="button"
                                    className="primary"
                                    disabled={
                                        paymentBusy ||
                                        (!awaitingConfirmation &&
                                            due > 0 &&
                                            (!method ||
                                                methods.loading ||
                                                Boolean(methods.error)))
                                    }
                                    onClick={confirmOrCheckPayment}
                                >
                                    {(checkingPayment || (busy && (!awaitingConfirmation || restoring))) && (
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
                        {((openUrl && awaitingConfirmation) || canSwitchPayment || canRetrySubmission || showRecoveryHelp) && (
                            <div className="checkout-secondary">
                                <div className="checkout-secondary-actions">
                                    {openUrl && awaitingConfirmation && (
                                        <button
                                            type="button"
                                            className="checkout-check-result"
                                            disabled={paymentBusy}
                                            onClick={checkPayment}
                                        >
                                            {pc("checkPayment")}
                                        </button>
                                    )}
                                    {canSwitchPayment && (
                                        <button type="button" disabled={paymentBusy} onClick={() => setRetryOpen(true)}>
                                            {pc("reselectPayment")}
                                        </button>
                                    )}
                                    {canRetrySubmission && (
                                        <button type="button" disabled={paymentBusy} onClick={retryPayment}>
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
                    <button type="button" disabled={paymentBusy} onClick={checkPayment}>
                        {pollStopped ? tx("继续检查") : pc("checkPayment")}
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
                                    checkPayment();
                                }}
                            >
                                {pc("checkPayment")}
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
                        if (!busy) closeCardPayment();
                    }}
                >
                    <div className="checkout-card">
                        <p className="pad">
                            {tx("合计")} {money(due + fee)}
                        </p>
                        {renderCard(cardMethod, submitCardPayment)}
                    </div>
                </Modal>
            )}
        </div>
    );
}
