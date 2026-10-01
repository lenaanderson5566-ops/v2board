import { describe, it, expect } from "vitest";
import { normalizeUserFilters, emailSearchFilters } from "./user-filters";
describe("user filters", () => {
    it("retains zero and GB units for server conversion", () => {
        expect(
            normalizeUserFilters([
                { key: "d", condition: ">=", value: 0 },
                { key: "transfer_enable", condition: ">", value: 1.5 },
            ]),
        ).toEqual([
            { key: "d", condition: ">=", value: 0 },
            { key: "transfer_enable", condition: ">", value: 1.5 },
        ]);
    });
    it("converts dates into Unix seconds", () => {
        expect(
            normalizeUserFilters([
                {
                    key: "expired_at",
                    condition: "<",
                    value: "2026-10-01T00:00:00Z",
                },
            ])[0].value,
        ).toBe(1790812800);
    });
    it("rejects unsupported fields, conditions and missing values", () => {
        for (const filter of [
            { key: "password", condition: "=", value: "x" },
            { key: "token", condition: "模糊", value: "x" },
            { key: "email", condition: "=", value: " " },
            { key: "d", condition: ">", value: -1 },
        ])
            expect(() => normalizeUserFilters([filter])).toThrow();
    });
    it("replaces the email criterion while retaining other filters", () => {
        const filters = [
            { key: "banned", condition: "=", value: 0 },
            { key: "email", condition: "=", value: "old" },
        ];
        expect(emailSearchFilters(filters, " new ")).toEqual([
            filters[0],
            { key: "email", condition: "模糊", value: "new" },
        ]);
        expect(emailSearchFilters(filters, "")).toEqual([filters[0]]);
    });
});
