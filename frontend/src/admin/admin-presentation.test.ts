import { describe, it, expect } from "vitest";
import { formPresentation, settingsPresentation } from "./admin-presentation";
describe("original admin presentation", () => {
    it("keeps price conversion and nullable behavior while grouping periods", () => {
        const fields = formPresentation(
            [
                { key: "group_id", label: "组" },
                {
                    key: "month_price",
                    label: "月付",
                    scale: 100,
                    nullable: true,
                },
                { key: "name", label: "名称" },
            ],
            "plans",
        );
        expect(fields.map((f) => f.key)).toEqual([
            "name",
            "month_price",
            "group_id",
        ]);
        expect(fields[1]).toMatchObject({
            scale: 100,
            nullable: true,
            columns: 2,
        });
    });
    it("keeps newer settings and business options after the original ordered fields", () => {
        const fields = settingsPresentation("site", [
            { key: "new_option", label: "新增" },
            { key: "app_url", label: "网址", type: "url" },
            { key: "app_name", label: "名称" },
        ]);
        expect(fields.map((f) => f.key)).toEqual([
            "app_name",
            "app_url",
            "new_option",
        ]);
        expect(fields[1]).toMatchObject({ type: "url", label: "站点网址" });
    });
});
