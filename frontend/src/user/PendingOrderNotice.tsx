import { useState } from "react";
import { bytes, money, request, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { c } from "../shared/credit-copy";
import { Modal } from "../shared/ui";
import { StatusBadge, orderStatusTone } from "../shared/StatusBadge";

export function PendingOrderNotice({ order, reload }: { order: Row; reload: () => void }) {
    const processing = Number(order.status) === 1;
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function cancel() {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            await request("user/order/cancel", { trade_no: order.trade_no });
            setConfirm(false);
            reload();
        } catch (error: any) {
            setError(error.message);
            reload();
        } finally {
            setBusy(false);
        }
    }
    return <>
        <div className="pending-order" role="status">
            <div className="pending-order-summary">
                <StatusBadge tone={orderStatusTone(order.status)}>{tx(processing ? "开通中" : "待支付")}</StatusBadge>
                <strong>{order.credit_bytes ? c("creditOrder", { amount: bytes(order.credit_bytes) }) : order.plan?.name || tx("账户充值")}</strong>
                <span className="pending-order-amount">{money(order.total_amount, order.currency || "CNY")}</span>
            </div>
            <div className="pending-order-actions">
                {!processing && <button type="button" className="pending-order-cancel" disabled={busy} onClick={() => { setError(""); setConfirm(true); }}>{tx("取消订单")}</button>}
                <a className="button primary" href={`#/order/${order.trade_no}`}>{tx(processing ? "查看开通进度" : "继续支付")}</a>
            </div>
        </div>
        {confirm && !processing && <Modal title={tx("取消订单")} close={() => { if (!busy) setConfirm(false); }}>
            <div className="pad">
                <p>{tx("取消后，已抵扣的余额会返还。已付款时请先检查支付结果。")}</p>
                {error && <p className="alert" role="alert">{error}</p>}
                <div className="actions">
                    <button disabled={busy} onClick={() => setConfirm(false)}>{tx("返回")}</button>
                    <button disabled={busy} onClick={cancel}>{tx(busy ? "提交中…" : "确认取消订单")}</button>
                </div>
            </div>
        </Modal>}
    </>;
}
