import type { Row } from "../shared/api";
export type SortKind = "plans" | "knowledge" | "payments" | "nodes";
export { moveItem } from "../shared/array-items";
export function sortPayload(kind: SortKind, items: Row[]): Row {
    if (kind === "nodes") {
        const result: Row = {};
        items.forEach((r, i) => {
            (result[r.type] ??= {})[r.id] = i + 1;
        });
        return result;
    }
    return {
        [kind === "plans"
            ? "plan_ids"
            : kind === "knowledge"
              ? "knowledge_ids"
              : "ids"]: items.map((r) => r.id),
    };
}
