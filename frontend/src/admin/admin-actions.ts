import type { Row } from "../shared/api";
export type SortKind = "plans" | "knowledge" | "payments" | "nodes";
export { moveItem } from "../shared/array-items";
// Rows on other pages and rows hidden by a filter keep their original positions.
export function mergePageOrder<T>(all: T[], reordered: T[]): T[] {
    const visible = new Set(reordered);
    let next = 0;
    return all.map(row => visible.has(row) ? reordered[next++] : row);
}
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
