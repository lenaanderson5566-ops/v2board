import type { Row } from "../shared/api";

export type AdminPlanDirectory = {
    data?: readonly Row[] | null;
    loading?: boolean;
    error?: string;
    reload?: () => void;
};

function planId(value: unknown): string {
    return value == null || value === "" || value === "null" || Number(value) === 0 ? "" : String(value);
}

/** Names come only from the API relationship or the plan directory, never from an ID. */
export function adminPlanLabel(
    row: Row,
    directory: AdminPlanDirectory = {},
    options: { includeId?: boolean; empty?: string } = {},
): string {
    const id = planId(row.plan_id ?? row.plan?.id);
    const plan = Array.isArray(directory.data)
        ? directory.data.find(item => item && String(item.id) === id)
        : undefined;
    const name = [row.plan_name, row.plan?.name, plan?.name]
        .find(value => typeof value === "string" && value.trim());
    if (name) return `${String(name).trim()}${options.includeId && id ? ` (#${id})` : ""}`;
    if (!id) return options.empty || "未指定套餐";
    const status = directory.error
        ? "套餐信息加载失败"
        : directory.loading
          ? "套餐加载中"
          : "套餐已删除或不可用";
    return `${status} (#${id})`;
}

/** Keep an existing, now unavailable selection visible and preserve its submitted ID. */
export function adminPlanOptions(
    plans: readonly Row[],
    selected?: unknown,
    directory: AdminPlanDirectory = { data: plans },
): [string, string][] {
    let values: unknown = selected;
    if (typeof values === "string" && values.trim().startsWith("[")) {
        try { values = JSON.parse(values); } catch { /* Preserve a scalar selection. */ }
    }
    const entries = Array.isArray(plans) ? plans.filter(plan => plan && plan.id != null) : [];
    const options: [string, string][] = entries.map(plan => [
        String(plan.id),
        adminPlanLabel({ plan_id: plan.id, plan_name: plan.name }, { data: entries }),
    ]);
    const known = new Set(options.map(([id]) => id));
    for (const value of Array.isArray(values) ? values : [values]) {
        const id = planId(value);
        if (!id || known.has(id)) continue;
        known.add(id);
        options.push([id, adminPlanLabel({ plan_id: id }, directory)]);
    }
    return options;
}
