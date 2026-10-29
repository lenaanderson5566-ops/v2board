import { useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe, StripeCardElement } from "@stripe/stripe-js";
import { request, query, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { e } from "../shared/experience-copy";
import { useData, State } from "../shared/ui";
import {
    pendingCheckoutPayment,
    clearCheckoutPayment,
} from "./checkout-navigation";
import { PaymentCheckout, type InitialPayment } from "./PaymentCheckout";
export function OrderView({
    tradeNo,
    initialPayment,
    embedded = false,
    onStatusChange,
}: {
    tradeNo: string;
    initialPayment?: InitialPayment;
    embedded?: boolean;
    onStatusChange?: (status: number) => void;
}) {
    const [confirmation] = useState(() => ({
        tradeNo,
        payment: initialPayment || pendingCheckoutPayment(tradeNo),
    }));
    const confirmedPayment =
        confirmation.tradeNo === tradeNo ? confirmation.payment : undefined;
    useEffect(() => {
        clearCheckoutPayment(tradeNo);
    }, [tradeNo]);
    const d = useData<Row>(query("user/order/detail", { trade_no: tradeNo }));
    useEffect(() => {
        if (d.data && String(d.data.trade_no) === tradeNo)
            onStatusChange?.(Number(d.data.status));
    }, [tradeNo, d.data?.trade_no, d.data?.status, onStatusChange]);
    useEffect(() => {
        if (!embedded && d.data && [2, 3, 4].includes(Number(d.data.status)))
            window.scrollTo({ top: 0, behavior: "instant" });
    }, [tradeNo, d.data?.status, embedded]);
    return (
        <div className="order-view" aria-busy={d.loading}>
            {embedded && (
                <p className="inline-order-refresh muted" role="status">
                    {d.loading ? e("refreshing") : "\u00a0"}
                </p>
            )}
            {d.data && String(d.data.trade_no) !== tradeNo ? (
                <div className="alert" role="alert">
                    {tx("订单状态暂不可用，请刷新后重试。")}
                    <button onClick={d.reload}>{tx("刷新")}</button>
                </div>
            ) : d.data ? (
                <>
                    {!embedded && d.loading && (
                        <p className="pad muted" role="status">
                            {e("refreshing")}
                        </p>
                    )}
                    {d.error && (
                        <div className="alert" role="alert">
                            {d.error}
                            <button onClick={d.reload}>{tx("刷新")}</button>
                        </div>
                    )}
                    <OrderDetail
                        key={tradeNo}
                        order={d.data}
                        reload={d.reload}
                        initialPayment={confirmedPayment}
                        embedded={embedded}
                    />
                </>
            ) : embedded && d.loading ? null : (
                <State {...d} retry={d.reload}>
                    <></>
                </State>
            )}
        </div>
    );
}

function OrderDetail({
    order,
    reload,
    initialPayment,
    embedded,
}: {
    order: Row;
    reload: () => void;
    initialPayment?: InitialPayment;
    embedded?: boolean;
}) {
    return (
        <PaymentCheckout
            order={order}
            embedded={embedded}
            initialPayment={initialPayment}
            reload={reload}
            renderCard={(method, pay) => (
                <StripeCard method={method} onToken={pay} />
            )}
        />
    );
}
function StripeCard({
    method,
    onToken,
}: {
    method: number;
    onToken: (token: string) => Promise<void>;
}) {
    const host = useRef<HTMLDivElement>(null),
        stripe = useRef<Stripe | null>(null),
        card = useRef<StripeCardElement | null>(null);
    const [error, setError] = useState(""),
        [ready, setReady] = useState(false),
        [busy, setBusy] = useState(false);
    useEffect(() => {
        let live = true;
        request<string>("user/comm/getStripePublicKey", { id: method })
            .then((r) => loadStripe(r.data))
            .then((s) => {
                if (!live || !s || !host.current) return;
                stripe.current = s;
                card.current = s.elements().create("card");
                card.current.mount(host.current);
                card.current.on("ready", () => setReady(true));
                card.current.on("change", (event) =>
                    setError(event.error?.message || ""),
                );
            })
            .catch((e) => {
                if (live) setError(e.message);
            });
        return () => {
            live = false;
            card.current?.destroy();
        };
    }, [method]);
    return (
        <div className="pad">
            <div ref={host} />
            {error && <div className="alert">{error}</div>}
            <button
                className="primary space"
                disabled={!ready || busy}
                onClick={async () => {
                    if (!stripe.current || !card.current) return;
                    setBusy(true);
                    try {
                        const result = await stripe.current.createToken(
                            card.current,
                        );
                        if (result.error) throw new Error(result.error.message);
                        if (result.token) await onToken(result.token.id);
                    } catch (e) {
                        setError((e as Error).message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {tx("确认支付")}
            </button>
        </div>
    );
}
