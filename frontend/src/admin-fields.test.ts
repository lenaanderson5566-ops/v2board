import { describe, it, expect } from "vitest";
import { configField } from "./admin-fields";
describe("configuration API contracts", () => {
    it("keeps password rate limits numeric rather than treating them as credentials", () => {
        expect(
            configField("password_limit_count", 5, "integer", "Limit").type,
        ).toBe("number");
        expect(
            configField("password_limit_expire", 60, "integer", "Minutes").type,
        ).toBe("number");
    });
    it("uses explicit switches for server boolean enums", () =>
        expect(configField("email_verify", 0, "in:0,1", "Verify").type).toBe(
            "switch",
        ));
    it("preserves meaningful event and reset enums", () => {
        expect(
            configField("new_order_event_id", 0, "in:0,1", "Event").options,
        ).toEqual([
            ["0", "保持已有流量"],
            ["1", "重置已用流量"],
        ]);
        expect(
            configField(
                "reset_traffic_method",
                0,
                "in:0,1,2,3,4",
                "Reset",
            ).options?.map(([value]) => value),
        ).toEqual(["0", "1", "2", "3", "4"]);
    });
    it("keeps footer and array settings editable with their accepted formats", () => {
        expect(
            configField("custom_footer_html", "", "nullable|string", "Footer")
                .type,
        ).toBe("textarea");
        expect(
            configField(
                "email_whitelist_suffix",
                [],
                "nullable|array",
                "Domains",
            ).type,
        ).toBe("json");
        expect(
            configField("server_token", "", "nullable|min:16", "Secret").type,
        ).toBe("password");
    });
});
