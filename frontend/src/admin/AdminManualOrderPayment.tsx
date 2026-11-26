import { useRef, useState, type FormEvent } from "react";
import { admin, money, request, type Row } from "../shared/api";
import { Modal } from "../shared/ui";
import { parseRecordedPaymentAmount } from "./billing-price-input";

export function AdminManualOrderPayment({ order, close, saved }: { order: Row; close: () => void; saved: () => void }) {
    const currency = order.currency || "CNY";
    const payable = Number(order.total_amount);
    const canRecord = (currency === "CNY" || currency === "USD") && Number.isSafeInteger(payable) && payable > 0;
    const [recordPayment, setRecordPayment] = useState(false);
    const [amount, setAmount] = useState(() => canRecord ? (payable / 100).toFixed(2) : "");
    const [reference, setReference] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [needsCheck, setNeedsCheck] = useState(false);
    const lock = useRef(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (lock.current || needsCheck) return;
        const payload: Row = { id: order.id, trade_no: order.trade_no };
        if (canRecord && recordPayment) {
            const receipt = reference.trim();
            try {
                if (!receipt || receipt.length > 120) throw new Error("请填写有效的线下收款凭据编号，最多 120 个字符。");
                const principal = parseRecordedPaymentAmount(amount);
                if (principal !== payable) throw new Error("线下实收本金须与订单外部应付金额一致。");
                payload.manual_payment = { reference: receipt, amount: principal, currency };
            } catch (reason) {
                setError((reason as Error).message);
                return;
            }
        }
        setError("");
        lock.current = true;
        setBusy(true);
        try {
            await request(admin("order/paid"), payload);
            saved();
        } catch (reason) {
            const status = (reason as { status?: number } | null)?.status;
            const requiresCheck = status !== 422 && status !== 429;
            setNeedsCheck(requiresCheck);
            setError(requiresCheck
                ? "暂时无法确认操作是否成功。请先核对订单状态。"
                : reason instanceof Error ? reason.message : "无法标记已付款，请检查资料后重试。");
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    async function checkStatus() {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const { data: fresh } = await request(admin("order/detail"), { id: order.id });
            if (!fresh || fresh.trade_no !== order.trade_no || fresh.status == null) {
                throw new Error("Order status unavailable");
            }
            if (Number(fresh.status) !== 0 || Number(fresh.total_amount) !== payable || (fresh.currency || "CNY") !== currency) {
                saved();
                return;
            }
            setNeedsCheck(false);
        } catch {
            setError("暂时无法读取订单状态，请稍后再核对。");
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    return <Modal title="标记已付款" className="admin-detail-dialog" close={close} dismissible={!busy} initialFocus="[data-manual-payment-cancel]">
        <form className="pad admin-dialog-form" aria-busy={busy} onSubmit={submit} noValidate>
            <p>订单号 <code>{order.trade_no}</code></p>
            <p>订单外部应付 <strong>{money(order.total_amount, currency)}</strong></p>
            <p className="muted">此操作会确认订单并安排开通。仅在核对无误后提交。</p>
            {canRecord && <label>
                <input type="checkbox" checked={recordPayment} disabled={busy || needsCheck} onChange={event => setRecordPayment(event.target.checked)} />
                已核对线下实收，登记收款凭据
            </label>}
            {canRecord && recordPayment ? <>
                <label>线下实收本金（{currency}）<input inputMode="decimal" value={amount} disabled={busy || needsCheck} onChange={event => setAmount(event.target.value)} /></label>
                <label>线下收款凭据编号<input value={reference} maxLength={120} disabled={busy || needsCheck} onChange={event => setReference(event.target.value)} /></label>
                <p className="muted">填写可核对的内部编号。请勿填写银行卡号等敏感资料。</p>
            </> : <p className="muted">本次确认将标为「未记录凭据」。</p>}
            {error && <p role="alert" className="alert">{error}</p>}
            <div className="admin-dialog-actions">
                <button type="button" data-manual-payment-cancel disabled={busy} onClick={close}>取消</button>
                {needsCheck ? <button type="button" className="primary" disabled={busy} onClick={() => void checkStatus()}>核对订单状态</button>
                    : <button type="submit" className="primary" disabled={busy}>{busy ? "正在确认…" : "确认已付款"}</button>}
            </div>
        </form>
    </Modal>;
}
