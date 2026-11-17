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

function isRecurringOrder(order: Row): boolean {
    return ["1", "2", "3"].includes(String(order.type))
        && Object.hasOwn(periodicPlanPrices, String(order.period))
        && !isCreditOrder(order);
}

function purchaseStageLabel(order: Row): OrderTypeLabel | undefined {
    if (!isRecurringOrder(order)) return;
    if (order.purchase_stage === "first_purchase") return {
        label: "首购", tone: "first",
        description: "首次有实付的周期套餐订单，含余额支付。免费、额度包和纯折抵订单不计入。",
    };
    if (order.purchase_stage === "expired_repurchase") return {
        label: "到期回购", tone: "returning",
        description: "此前已有付费周期套餐，下单时原周期已到期。",
    };
    if (order.purchase_stage === "repeat_purchase" && String(order.type) === "1") return {
        label: "再次购买", tone: "plan",
        description: "此前已有付费周期套餐订单，本笔未确认属于到期回购。",
    };
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
    const type = Object.hasOwn(orderTypes, key) ? orderTypes[key] : { label: key || "—", tone: "neutral" } as const;
    const stage = purchaseStageLabel(order);
    if (stage) return key === "1" ? stage : { ...stage, label: `${type.label} · ${stage.label}` };
    if (key === "1" && isRecurringOrder(order)) return {
        label: "周期购买", tone: "neutral",
        description: "周期套餐购买，现有记录不足以确认首购或到期回购。",
    };
    return type;
}

export function adminOrderType(order: Row) {
    const { label, tone, description } = orderTypeLabel(order);
    if (label === "—") return label;
    return <span title={description}><StatusBadge className={`admin-order-type order-type-${tone}`}
        tone={tone === "first" ? "success" : tone === "plan" ? "info" : "neutral"}>
        {label}
    </StatusBadge></span>;
}

export function adminOrderTypeDescription(order: Row): string | undefined {
    return orderTypeLabel(order).description;
}

export function adminRepurchaseGap(order: Row): string | undefined {
    if (order.purchase_stage !== "expired_repurchase" || !purchaseStageLabel(order)) return;
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
