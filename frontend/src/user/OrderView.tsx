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
}: {
    tradeNo: string;
    initialPayment?: InitialPayment;
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
        if (d.data && [2, 3, 4].includes(Number(d.data.status)))
            window.scrollTo({ top: 0, behavior: "instant" });
    }, [tradeNo, d.data?.status]);
    return (
        <div className="order-view" aria-busy={d.loading}>
            {d.data ? (
                <>
                    {d.loading && (
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
                    />
                </>
            ) : (
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
}: {
    order: Row;
    reload: () => void;
    initialPayment?: InitialPayment;
}) {
    return (
        <PaymentCheckout
            order={order}
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
