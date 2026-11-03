import type { Row } from "../shared/api";
import { adminPlanLabel, type AdminPlanDirectory } from "./admin-plan-reference";

const orderTypes: Record<string, string> = {
    1: "新购", 2: "续费", 3: "变更套餐", 4: "流量重置", 5: "额度购买",
};
const orderPeriods: Record<string, string> = {
    month_price: "月付", quarter_price: "季付", half_year_price: "半年付",
    year_price: "年付", two_year_price: "两年付", three_year_price: "三年付",
    onetime_price: "额度包", reset_price: "重置包",
};

function isBalanceOrder(order: Row): boolean {
    return String(order.type) === "9" || order.period === "deposit";
}

export function adminOrderType(order: Row): string {
    if (isBalanceOrder(order)) {
        return order.callback_no === "佣金划转 Commission transfer" ? "佣金划转" : "余额充值";
    }
    const key = String(order.type ?? "");
    return Object.hasOwn(orderTypes, key) ? orderTypes[key] : key || "—";
}

export function adminOrderPeriod(order: Row): string {
    if (isBalanceOrder(order)) return "不适用";
    const key = String(order.period ?? "");
    return Object.hasOwn(orderPeriods, key) ? orderPeriods[key] : key || "—";
}

export function adminOrderPlan(order: Row, directory: AdminPlanDirectory): string {
    return isBalanceOrder(order) ? "—" : adminPlanLabel(order, directory);
}
