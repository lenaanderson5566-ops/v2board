import type { Row } from "../shared/api";
import { formatNumber } from "../shared/number-format";
import { StatusBadge } from "../shared/StatusBadge";
import { adminPlanLabel, type AdminPlanDirectory } from "./admin-plan-reference";
import { periodicPlanPrices } from "./admin-plan-products";

type OrderTypeLabel = {
    label: string;
    tone: "neutral" | "first" | "returning" | "plan" | "traffic";
    description?: string;
};

const orderTypes: Record<string, OrderTypeLabel> = {
    1: { label: "新购", tone: "neutral" },
    2: { label: "续费", tone: "plan" },
    3: { label: "变更套餐", tone: "plan" },
    4: { label: "流量重置", tone: "traffic" },
    5: { label: "额度购买", tone: "traffic" },
};
const orderPeriods: Record<string, string> = {
    ...periodicPlanPrices,
    onetime_price: "额度包", reset_price: "重置包",
};

function isBalanceOrder(order: Row): boolean {
    return String(order.type) === "9" || order.period === "deposit";
}

function isCreditOrder(order: Row): boolean {
    return order.period === "onetime_price" || Number(order.credit_bytes ?? 0) > 0;
}

function isUnconfirmedOrder(order: Row): boolean {
    return ["0", "2"].includes(String(order.status));
}

function isRecurringOrder(order: Row): boolean {
    return ["1", "2", "3"].includes(String(order.type))
        && Object.hasOwn(periodicPlanPrices, String(order.period))
        && !isCreditOrder(order);
}

function isUnverifiedManualPayment(order: Row): boolean {
    return order.callback_no === "manual_operation" && order.manual_payment_verified !== true;
}

function purchaseStageLabel(order: Row): OrderTypeLabel | undefined {
    if (!isRecurringOrder(order)) return;
    if (isUnconfirmedOrder(order)) {
        const pending = String(order.status) === "0";
        const context = order.checkout_purchase_context ?? (pending ? order.pending_purchase_context : undefined);
        if (context === "repeat") return {
            label: "再次购买", tone: "plan",
            description: "这笔订单下单前已有付费周期套餐记录，含余额支付。",
        };
        if (String(order.type) === "1" && (context === "unknown" || (!pending && context !== "new"))) return {
            label: "证据不足", tone: "neutral",
            description: "现有记录不足以确认下单前是否已有付费周期套餐。",
        };
        return;
    }
    if (isUnverifiedManualPayment(order)) return Number(order.total_amount) === 0 && Number(order.balance_amount ?? 0) === 0
        ? { label: "无实付", tone: "neutral" }
        : { label: "实收未核实", tone: "neutral", description: "订单已人工确认，购买阶段需要可核对的实收记录。" };
    if (order.purchase_stage === "first_purchase") return {
        label: "首购", tone: "first",
        description: "首次有实付的周期套餐订单，含余额支付。免费、额度包和纯折抵订单不计入。",
    };
    if (["repeat_purchase", "expired_repurchase"].includes(String(order.purchase_stage))) return {
        label: "再次购买", tone: "plan",
        description: "此前已有付费周期套餐订单。",
    };
    if (String(order.type) === "1") return {
        label: "证据不足", tone: "neutral",
        description: "现有记录不足以确认首次实付或再次购买。",
    };
}

function repurchaseExpiryStatus(order: Row): "expired" | "not_expired" | "unknown" | undefined {
    if (isUnconfirmedOrder(order) || !isRecurringOrder(order) || isUnverifiedManualPayment(order)
        || !["repeat_purchase", "expired_repurchase"].includes(String(order.purchase_stage))) return;
    // Preserve older server responses while preferring the explicit evidence field.
    const status = order.repurchase_expiry_status ?? (order.purchase_stage === "expired_repurchase" ? "expired" : "unknown");
    return status === "expired" || status === "not_expired" ? status : "unknown";
}

function repurchaseExpiryLabel(order: Row): OrderTypeLabel | undefined {
    switch (repurchaseExpiryStatus(order)) {
        case "expired": return {
            label: "到期回购", tone: "returning",
            description: "下单时原周期已到期，依据下单时保存的到期记录确认。",
        };
        case "not_expired": return {
            label: "有效期内购买", tone: "plan",
            description: "下单时原周期仍在有效期内。",
        };
        case "unknown": return {
            label: "到期情况不详", tone: "neutral",
            description: "缺少可核实的下单前到期记录，无法确认是否到期回购。",
        };
    }
}

function orderTypeLabel(order: Row): OrderTypeLabel {
    if (isBalanceOrder(order)) {
        const label = order.callback_no === "佣金划转 Commission transfer" ? "佣金划转" : "余额充值";
        return { label, tone: "neutral" };
    }
    // Historical one-time and reset orders can retain an earlier numeric business type.
    if (isCreditOrder(order)) return orderTypes[5];
    if (order.period === "reset_price") return orderTypes[4];
    const key = String(order.type ?? "");
    return Object.hasOwn(orderTypes, key) ? orderTypes[key] : { label: key || "—", tone: "neutral" };
}

function orderBadge({ label, tone, description }: OrderTypeLabel) {
    if (label === "—") return label;
    return <span title={description}><StatusBadge className={`admin-order-type order-type-${tone}`}
        tone={tone === "first" ? "success" : tone === "plan" ? "info" : "neutral"}>
        {label}
    </StatusBadge></span>;
}

export function adminOrderType(order: Row) {
    return orderBadge(orderTypeLabel(order));
}

export function adminOrderPurchaseRecord(order: Row) {
    const stage = purchaseStageLabel(order);
    return stage ? orderBadge(stage) : undefined;
}

export function adminOrderPayment(order: Row): string {
    if (order.callback_no === "manual_operation") {
        return order.manual_payment_verified === true ? "人工确认（已记录凭据）" : "人工确认（未记录凭据）";
    }
    return typeof order.payment_display === "string" && order.payment_display ? order.payment_display : "—";
}

export function adminRepurchaseContext(order: Row) {
    const context = repurchaseExpiryLabel(order);
    return context ? orderBadge(context) : undefined;
}

export function adminOrderTypeDescription(order: Row): string | undefined {
    return repurchaseExpiryLabel(order)?.description ?? purchaseStageLabel(order)?.description ?? orderTypeLabel(order).description;
}

export function adminRepurchaseGap(order: Row): string | undefined {
    if (repurchaseExpiryStatus(order) !== "expired") return;
    const days = order.repurchase_gap_days;
    if (!Number.isSafeInteger(days) || days < 0) return;
    return days === 0 ? "到期后不足 1 天回购" : `到期 ${formatNumber(days)} 天后回购`;
}

export function adminOrderPeriod(order: Row): string {
    if (isBalanceOrder(order)) return "不适用";
    if (isCreditOrder(order)) return "额度包";
    const key = String(order.period ?? "");
    return Object.hasOwn(orderPeriods, key) ? orderPeriods[key] : key || "—";
}

export function adminOrderPlan(order: Row, directory: AdminPlanDirectory): string {
    return isBalanceOrder(order) ? "—" : adminPlanLabel(order, directory);
}
