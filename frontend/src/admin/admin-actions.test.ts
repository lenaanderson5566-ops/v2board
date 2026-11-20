import { describe, it, expect } from "vitest";
import { mergePageOrder, moveItem, sortPayload } from "./admin-actions";
describe("admin ordering", () => {
    it("moves items without changing the input or losing entries", () => {
        const rows = [{ id: 2 }, { id: 4 }, { id: 9 }];
        expect(moveItem(rows, 2, 0).map((x) => x.id)).toEqual([9, 2, 4]);
        expect(rows.map((x) => x.id)).toEqual([2, 4, 9]);
        expect(moveItem(rows, -1, 2)).toEqual(rows);
    });
    it("uses the distinct endpoint contracts", () => {
        expect(sortPayload("plans", [{ id: 9 }, { id: 2 }])).toEqual({
            plan_ids: [9, 2],
        });
        expect(sortPayload("knowledge", [{ id: 3 }])).toEqual({
            knowledge_ids: [3],
        });
        expect(sortPayload("payments", [{ id: 4 }])).toEqual({ ids: [4] });
    });
    it("reorders a filtered page without moving hidden rows or other pages", () => {
        const all = [1, 2, 3, 4, 5, 6].map(id => ({ id }));
        const reordered = mergePageOrder(all, [all[4], all[2]]);
        expect(sortPayload("plans", reordered)).toEqual({ plan_ids: [1, 2, 5, 4, 3, 6] });
        expect(all.map(row => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
    });
    it("keeps V2Box nodes in global order", () => {
        expect(
            sortPayload("nodes", [
                { type: "v2box", id: 3 },
                { type: "v2box", id: 1 },
                { type: "v2box", id: 2 },
            ]),
        ).toEqual({ v2box: { 3: 1, 1: 2, 2: 3 } });
    });
});
