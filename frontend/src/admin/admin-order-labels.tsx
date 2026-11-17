import type { Row } from "../shared/api";
import { formatNumber } from "../shared/number-format";
import { StatusBadge } from "../shared/StatusBadge";
import { adminPlanLabel, type AdminPlanDirectory } from "./admin-plan-reference";
import { periodicPlanPrices } from "./admin-plan-products";

type OrderTypeLabel = {
    label: string;
    tone: "neutral" | "first" | "returning" | "plan" | "traffic";
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

function purchaseStageLabel(order: Row): OrderTypeLabel | undefined {
    if (!["1", "2", "3"].includes(String(order.type))
        || !Object.hasOwn(periodicPlanPrices, String(order.period))
        || Number(order.credit_bytes ?? 0) > 0) return;
    if (order.purchase_stage === "first_purchase") return { label: "首购", tone: "first" };
    if (order.purchase_stage === "expired_repurchase") return { label: "到期回购", tone: "returning" };
}

function orderTypeLabel(order: Row): OrderTypeLabel {
    if (isBalanceOrder(order)) {
        const label = order.callback_no === "佣金划转 Commission transfer" ? "佣金划转" : "余额充值";
        return { label, tone: "neutral" };
    }
    const key = String(order.type ?? "");
    const type = Object.hasOwn(orderTypes, key) ? orderTypes[key] : { label: key || "—", tone: "neutral" } as const;
    const stage = purchaseStageLabel(order);
    if (!stage) return type;
    return key === "1" ? stage : { label: `${type.label} · ${stage.label}`, tone: stage.tone };
}

export function adminOrderType(order: Row) {
    const { label, tone } = orderTypeLabel(order);
    if (label === "—") return label;
    return <StatusBadge className={`admin-order-type order-type-${tone}`}
        tone={tone === "first" ? "success" : tone === "plan" ? "info" : "neutral"}>
        {label}
    </StatusBadge>;
}

export function adminRepurchaseGap(order: Row): string | undefined {
    if (order.purchase_stage !== "expired_repurchase" || !purchaseStageLabel(order)) return;
    const days = order.repurchase_gap_days;
    if (!Number.isSafeInteger(days) || days < 0) return;
    return days === 0 ? "到期后不足 1 天回购" : `到期 ${formatNumber(days)} 天后回购`;
}

export function adminOrderPeriod(order: Row): string {
    if (isBalanceOrder(order)) return "不适用";
    const key = String(order.period ?? "");
    return Object.hasOwn(orderPeriods, key) ? orderPeriods[key] : key || "—";
}

export function adminOrderPlan(order: Row, directory: AdminPlanDirectory): string {
    return isBalanceOrder(order) ? "—" : adminPlanLabel(order, directory);
}
