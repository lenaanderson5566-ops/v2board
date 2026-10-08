import { describe, expect, it } from "vitest";
import { paymentIcons, paymentIconInitial, resolvePaymentIcon } from "./payment-icons";
import { paymentPayload } from "./payment-fields";

describe("payment icon selection", () => {
    it("previews complete vector assets without font-dependent logos", () => {
        for (const item of paymentIcons) {
            if (item.id === "alipay-blue") continue;
            const svg = decodeURIComponent(item.source.split(",")[1]);
            expect(svg).toMatch(/viewBox="[^"]+"/);
            expect(svg).toContain("<path");
            expect(svg).not.toMatch(/<text\b|<script\b|<foreignObject\b/);
        }
    });
    it("defaults to a card and restores saved selections", () => {
        expect(paymentIconInitial({}).iconPreset).toBe("card");
        const alipay = paymentIcons.find((item) => item.id === "alipay")!;
        expect(paymentIconInitial({ icon: `/payment-icons/${alipay.id}.svg` })).toMatchObject({ icon: "", iconPreset: "alipay" });
    });
    it("saves and restores the blue Alipay PNG while allowing a custom URL", () => {
        expect(paymentIcons.find((item) => item.id === "alipay-blue")?.source).toBeTruthy();
        expect(resolvePaymentIcon("", "alipay-blue")).toBe("/payment-icons/alipay-blue.png");
        expect(paymentIconInitial({ icon: "/payment-icons/alipay-blue.png" })).toMatchObject({ icon: "", iconPreset: "alipay-blue" });
        expect(resolvePaymentIcon("https://example.com/custom.png", "alipay-blue")).toBe("https://example.com/custom.png");
    });
    it("prefers custom links and retains the selected fallback", () => {
        const saved = paymentPayload({ icon: " https://example.com/pay.png ", iconPreset: "wechat" }, {}, "EPay", {});
        expect(saved.icon).toBe("https://example.com/pay.png");
        expect(paymentIconInitial(saved)).toMatchObject({ icon: saved.icon, iconPreset: "wechat" });
        const cleared = paymentPayload({ ...paymentIconInitial(saved), icon: " " }, {}, "EPay", saved);
        expect(cleared.icon).toBe(resolvePaymentIcon("", "wechat"));
        expect(cleared.config._console_icon).toBe("wechat");
    });
    it("keeps existing custom URLs compatible", () => {
        expect(paymentIconInitial({ icon: "https://example.com/old.svg" }).icon).toBe("https://example.com/old.svg");
        expect(paymentPayload({ icon: "https://example.com/old.svg" }, {}, "EPay", {}).icon).toBe("https://example.com/old.svg");
    });
});
