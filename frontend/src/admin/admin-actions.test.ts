import { describe, it, expect } from "vitest";
import { moveItem, sortPayload } from "./admin-actions";
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
    it("keeps colliding node IDs distinct by backend while maintaining global order", () => {
        expect(
            sortPayload("nodes", [
                { type: "v2node", id: 1 },
                { type: "v2box", id: 1 },
                { type: "v2node", id: 2 },
            ]),
        ).toEqual({ v2node: { 1: 1, 2: 3 }, v2box: { 1: 2 } });
    });
});
