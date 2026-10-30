import { expect, it } from "vitest";
import { adminUserLabel } from "./admin-user-label";
import { adminPlanLabel, adminPlanOptions } from "./admin-plan-reference";
it("shows ID and email together, including unavailable accounts", () => {
    expect(adminUserLabel({ user_id: 7, email: "user@example.com" })).toBe(
        "ID: 7 · user@example.com",
    );
    expect(adminUserLabel({ user_id: 7 })).toBe("ID: 7 · 邮箱不可用");
    expect(adminUserLabel({ user_id: 7, email: "null" })).toBe(
        "ID: 7 · 邮箱不可用",
    );
});
it("uses authoritative plan names and distinguishes missing, loading and failed references", () => {
    const directory = { data: [{ id: 7, name: "Basic" }] };
    expect(adminPlanLabel({ plan_id: 7 }, directory)).toBe("Basic");
    expect(adminPlanLabel({ plan_id: 7, plan_name: "Related name" }, directory)).toBe("Related name");
    expect(adminPlanLabel({ plan_id: 7, plan: { name: "Relation" } }, directory)).toBe("Relation");
    expect(adminPlanLabel({ plan_id: 99 }, { loading: true })).toBe("套餐加载中 (#99)");
    expect(adminPlanLabel({ plan_id: 99 }, directory)).toBe("套餐已删除或不可用 (#99)");
    expect(adminPlanLabel({ plan_id: 99 }, { data: [], error: "Unavailable" })).toBe("套餐信息加载失败 (#99)");
    expect(adminPlanLabel({ plan_id: 7 }, { ...directory, error: "Refresh failed" })).toBe("Basic");
    expect(adminPlanLabel({ plan_id: null }, directory)).toBe("未指定套餐");
    expect(adminPlanLabel({ plan_id: "null" }, directory)).toBe("未指定套餐");
    expect(adminPlanLabel({ plan_id: 99 }, { data: true } as any)).toBe("套餐已删除或不可用 (#99)");
});
it("retains unavailable plan selections without replacing their identifiers", () => {
    const plans = [{ id: 7, name: "Basic" }];
    expect(adminPlanOptions(plans, "99")).toEqual([
        ["7", "Basic"], ["99", "套餐已删除或不可用 (#99)"],
    ]);
    expect(adminPlanOptions(plans, "[7,99,99]")).toHaveLength(2);
    expect(adminPlanOptions(plans, "null")).toEqual([["7", "Basic"]]);
    expect(adminPlanOptions([], [99], { data: [], error: "Unavailable" })).toEqual([
        ["99", "套餐信息加载失败 (#99)"],
    ]);
    expect(adminPlanOptions(true as any, 99)).toEqual([["99", "套餐已删除或不可用 (#99)"]]);
});
