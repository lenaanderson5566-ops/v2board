import { describe, expect, it } from "vitest";
import { paymentIcons, paymentIconInitial, resolvePaymentIcon } from "./payment-icons";
import { paymentPayload } from "./payment-fields";

describe("payment icon selection", () => {
    it("defaults to a card and restores saved selections", () => {
        expect(paymentIconInitial({}).iconPreset).toBe("card");
        const alipay = paymentIcons.find((item) => item.id === "alipay")!;
        expect(paymentIconInitial({ icon: `/payment-icons/${alipay.id}.svg` })).toMatchObject({ icon: "", iconPreset: "alipay" });
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
