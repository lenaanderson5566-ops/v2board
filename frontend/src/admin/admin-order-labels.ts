import type { Row } from "../shared/api";
import { formatNumber } from "../shared/number-format";
import { adminPlanLabel, type AdminPlanDirectory } from "./admin-plan-reference";
import { periodicPlanPrices } from "./admin-plan-products";

const orderTypes: Record<string, string> = {
    1: "新购", 2: "续费", 3: "变更套餐", 4: "流量重置", 5: "额度购买",
};
const orderPeriods: Record<string, string> = {
    ...periodicPlanPrices,
    onetime_price: "额度包", reset_price: "重置包",
};

function isBalanceOrder(order: Row): boolean {
    return String(order.type) === "9" || order.period === "deposit";
}

function purchaseStageLabel(order: Row): string | undefined {
    if (!["1", "2", "3"].includes(String(order.type))
        || !Object.hasOwn(periodicPlanPrices, String(order.period))
        || Number(order.credit_bytes ?? 0) > 0) return;
    if (order.purchase_stage === "first_purchase") return "首购";
    if (order.purchase_stage === "expired_repurchase") return "到期回购";
}

export function adminOrderType(order: Row): string {
    if (isBalanceOrder(order)) {
        return order.callback_no === "佣金划转 Commission transfer" ? "佣金划转" : "余额充值";
    }
    const key = String(order.type ?? "");
    const label = Object.hasOwn(orderTypes, key) ? orderTypes[key] : key || "—";
    const stage = purchaseStageLabel(order);
    if (!stage) return label;
    return key === "1" ? stage : `${label} · ${stage}`;
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
