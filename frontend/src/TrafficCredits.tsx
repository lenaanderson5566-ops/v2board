import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { bytes, money, navigate, request, type Row } from "./api";
import { tx } from "./i18n";
import { c } from "./credit-copy";
import { Modal, State, useData } from "./ui";
import { unfinishedOrder } from "./billing-flow";

export function TrafficCredits({ balance = 0 }: { balance?: number }) {
    const [open, setOpen] = useState(false);
    return (
        <section className="settings-section traffic-credits">
            <header>
                <h2>{c("credits")}</h2>
            </header>
            <div className="settings-card credit-balance-card">
                <div className="settings-row">
                    <div>
                        <span className="muted">{c("remaining")}</span>
                        <strong className="balance-amount">
                            {bytes(balance)}
                        </strong>
                    </div>
                    <button
                        className="credit-add"
                        aria-label={c("buy")}
                        onClick={() => setOpen(true)}
                    >
                        <Plus size={20} />
                    </button>
                </div>
                <p className="muted">{c("help")}</p>
            </div>
            {open && <CreditPurchase close={() => setOpen(false)} />}
        </section>
    );
}
export function CreditPurchase({ close }: { close: () => void }) {
    const catalog = useData<Row[]>("user/credit/fetch"),
        orders = useData<Row[]>("user/order/fetch");
    const [selected, setSelected] = useState(0),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const lock = useRef(false);
    const pack =
        catalog.data?.find((p) => Number(p.id) === selected) ||
        catalog.data?.[0];
    const pending = unfinishedOrder(orders.data || []);
    async function buy() {
        if (!pack || lock.current || pending) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await request<string>("user/order/save", {
                plan_id: pack.id,
                period: "onetime_price",
            });
            navigate(`order/${result.data}`);
            close();
        } catch (cause) {
            setError((cause as Error).message);
            orders.reload();
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return (
        <Modal
            title={c("buy")}
            close={() => {
                if (!lock.current) close();
            }}
            variant="modal"
        >
            <div className="credit-checkout pad">
                <p className="muted">{c("help")}</p>
                <State
                    loading={catalog.loading || orders.loading}
                    error={catalog.error || orders.error}
                    data={catalog.data && orders.data}
                    retry={() => {
                        catalog.reload();
                        orders.reload();
                    }}
                >
                    {pending ? (
                        <div className="pending-order">
                            <p>{tx("你有一笔待支付订单")}</p>
                            <a
                                className="button primary"
                                href={`#/order/${pending.trade_no}`}
                            >
                                {tx("查看")}
                            </a>
                        </div>
                    ) : pack ? (
                        <>
                            <label htmlFor="credit-quantity">
                                {c("quantity")}
                            </label>
                            <select
                                id="credit-quantity"
                                value={pack.id}
                                onChange={(e) =>
                                    setSelected(Number(e.target.value))
                                }
                                disabled={busy}
                            >
                                {catalog.data?.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {bytes(item.bytes)} · {item.name} —{" "}
                                        {money(item.price)}
                                    </option>
                                ))}
                            </select>
                            <p className="muted">{c("access")}</p>
                            <div className="settings-row credit-price">
                                <strong>
                                    {c("creditOrder", {
                                        amount: bytes(pack.bytes),
                                    })}
                                </strong>
                                <strong>{money(pack.price)}</strong>
                            </div>

                            <button
                                className="primary"
                                disabled={busy}
                                onClick={buy}
                            >
                                {busy ? tx("提交中…") : c("checkout")}
                            </button>
                        </>
                    ) : (
                        <p>{c("empty")}</p>
                    )}
                </State>
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </Modal>
    );
}
