import { useState, type ReactNode } from "react";
import { adminStatusCell } from "../shared/admin-status";
import { admin, date, money, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { Modal, State, Table, useData } from "../shared/ui";
import { adminOrderPeriod, adminOrderPlan, adminOrderType } from "./admin-order-labels";
import type { AdminPlanDirectory } from "./admin-plan-reference";
import { AdminDetails } from "./admin-section";
import { adminUserLabel } from "./admin-user-label";
import { PaymentCallbackHistory } from "./PaymentCallbackHistory";

export function AdminOrderDetails({
    id,
    close,
    plans = {},
    commissionMode = false,
    renderUser = adminUserLabel,
}: {
    id: number;
    close: () => void;
    plans?: AdminPlanDirectory;
    commissionMode?: boolean;
    renderUser?: (row: Row) => ReactNode;
}) {
    const detail = useData<Row>(admin("order/detail"), { id });
    const order = detail.data;
    const [copyFeedback, setCopyFeedback] = useState("");
    async function copyOrderNumber(tradeNumber: string) {
        try {
            await navigator.clipboard.writeText(tradeNumber);
            setCopyFeedback(tx("订单号已复制。"));
        } catch {
            setCopyFeedback(tx("复制失败，请手动选择订单号复制。"));
        }
    }

    return <Modal title="订单详情" variant="modal" className="admin-detail-dialog" close={close}>
        <div className="admin-detail-body">
            <State {...detail} retry={detail.reload}>
                {order && <div className="admin-detail-stack">
                    <div className="admin-order-detail-overview">
                        <section className="admin-detail-section">
                            <h3 className="admin-detail-section-head">订单概况</h3>
                            <AdminDetails className="admin-detail-grid admin-order-facts" items={[
                                { label: "订单号", value: order.trade_no && <div className="admin-order-number">
                                    <code>{order.trade_no}</code>
                                    <button type="button" onClick={() => void copyOrderNumber(order.trade_no)}>{tx("复制订单号")}</button>
                                    <span role="status">{copyFeedback}</span>
                                </div> },
                                { label: "创建时间", value: date(order.created_at) },
                                { label: "支付时间", value: date(order.paid_at) },
                                { label: "订单状态", value: adminStatusCell("status", "订单状态", order.status) },
                                { label: "用户（ID / 邮箱）", value: renderUser(order) },
                                { label: "类型", value: adminOrderType(order) },
                                { label: "套餐", value: adminOrderPlan(order, plans) },
                                { label: "周期", value: adminOrderPeriod(order) },
                                { label: "更新时间", value: date(order.updated_at) },
                            ]} />
                        </section>
                        <section className="admin-detail-section">
                            <h3 className="admin-detail-section-head">金额与渠道</h3>
                            <AdminDetails className="admin-detail-grid admin-order-payment" items={[
                                { label: "支付金额", value: <strong className="admin-order-amount">{money(order.total_amount, order.currency)}</strong> },
                                { label: "支付方式", value: order.payment_display },
                                { label: "余额支付", value: money(order.balance_amount, order.currency) },
                                { label: "优惠金额", value: money(order.discount_amount, order.currency) },
                                { label: "退回金额", value: money(order.refund_amount, order.currency) },
                                { label: "折抵金额", value: money(order.surplus_amount, order.currency) },
                                { label: "支付接口", value: order.payment_provider },
                                { label: "回调单号", value: order.callback_no },
                            ]} />
                        </section>
                    </div>
                    <PaymentCallbackHistory history={order.callback_history} attempts={order.payment_attempt_history} paidAt={order.paid_at} />
                    {commissionMode && <section className="admin-detail-section">
                        <h3 className="admin-detail-section-head">佣金记录</h3>
                        <AdminDetails className="admin-detail-grid" items={[
                            { label: "佣金状态", value: adminStatusCell("commission_status", "佣金状态", order.commission_status) },
                            { label: "佣金金额", value: money(order.commission_balance, order.currency) },
                            { label: "实际佣金", value: money(order.actual_commission_balance, order.currency) },
                        ]} />
                        {order.commission_log?.length ? <Table compact data={order.commission_log} columns={[
                            ["invite_user_id", "邀请人（ID / 邮箱）", record => adminUserLabel({ user_id: record.invite_user_id, email: record.invite_email })],
                            ["get_amount", "金额", record => money(record.get_amount, record.currency)],
                            ["created_at", "时间", record => date(record.created_at)],
                        ]} /> : <p className="muted">暂无佣金记录。</p>}
                    </section>}
                    <section className="admin-detail-section">
                        <h3 className="admin-detail-section-head">折抵订单</h3>
                        {order.surplus_orders?.length ? <Table compact data={order.surplus_orders} columns={[
                            ["trade_no", "订单号"],
                            ["total_amount", "金额", record => money(record.total_amount, record.currency)],
                        ]} /> : <p className="muted">暂无折抵订单。</p>}
                    </section>
                    {order.invite_user_id && <a href={`#/users?invite_user_id=${order.invite_user_id}`}>查看邀请人邀请的用户</a>}
                </div>}
            </State>
        </div>
    </Modal>;
}
