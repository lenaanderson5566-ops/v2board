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
    it("keeps colliding node IDs distinct by protocol while maintaining global order", () => {
        expect(
            sortPayload("nodes", [
                { type: "vmess", id: 1 },
                { type: "vless", id: 1 },
                { type: "vmess", id: 2 },
            ]),
        ).toEqual({ vmess: { 1: 1, 2: 3 }, vless: { 1: 2 } });
    });
});
