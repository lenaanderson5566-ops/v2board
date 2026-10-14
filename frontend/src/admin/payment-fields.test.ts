import { describe, it, expect } from "vitest";
import { paymentIcons, paymentIconInitial, resolvePaymentIcon } from "./payment-icons";
import {
    paymentFields,
    paymentInitial,
    paymentPayload,
} from "./payment-fields";
describe("payment configuration", () => {
    it("renders MGate credentials and currency through the dynamic gateway form", () => {
        const form = {
            mgate_url: { type: "input", required: true },
            mgate_app_id: { type: "input", required: true },
            mgate_app_secret: { type: "input", required: true },
            mgate_source_currency: { type: "input", value: "CNY" },
        };
        expect(
            paymentFields(form).find((f) => f.key === "config.mgate_app_secret")
                ?.type,
        ).toBe("password");
        expect(
            paymentFields(form).find((f) => f.key === "config.mgate_url")
                ?.required,
        ).toBe(true);
        const values = paymentInitial({}, form, false);
        expect(values["config.mgate_source_currency"]).toBe("CNY");
        expect(
            paymentPayload(
                {
                    ...values,
                    "config.mgate_app_id": "app",
                    "config.mgate_app_secret": "test-secret",
                    "config.mgate_url": "https://gateway.example",
                },
                form,
                "MGate",
                {},
            ).config,
        ).toEqual({
            mgate_url: "https://gateway.example",
            mgate_app_id: "app",
            mgate_app_secret: "test-secret",
            mgate_source_currency: "CNY",
        });
    });
    it("keeps Stripe private credentials masked and removes old stored notices", () => {
        const form = {
            stripe_sk_live: { type: "input" },
            alert1: { type: "alert" },
        };
        expect(paymentFields(form)[0].type).toBe("password");
        expect(
            paymentPayload(
                { "config.stripe_sk_live": "test-only" },
                form,
                "StripeCheckout",
                { payment: "StripeCheckout", config: { alert1: "old" } },
            ).config,
        ).toEqual({ stripe_sk_live: "test-only" });
    });
    const form = {
        key: { label: "Secret", type: "input" },
        currency: { type: "input", value: "CNY" },
        alert1: { type: "alert", content: "Help" },
    };
    it("renders notices separately and excludes them from submitted configuration", () => {
        expect(paymentFields(form).map((f) => f.key)).toEqual([
            "config.key",
            "config.currency",
        ]);
        expect(paymentFields(form)[0].type).toBe("password");
        expect(
            paymentPayload(
                {
                    "config.key": "test",
                    "config.currency": "CNY",
                    "config.alert1": "junk",
                    handling_fee_percent: 0,
                },
                form,
                "Paytaro",
                {},
            ),
        ).toEqual({
            handling_fee_percent: 0,
            payment: "Paytaro",
            config: { key: "test", currency: "CNY" },
        });
    });
    it("uses server defaults and retains saved values and extensions", () => {
        const initial = {
            payment: "Paytaro",
            name: "Display",
            config: { key: "existing", custom: "keep" },
        };
        expect(paymentInitial(initial, form, true)["config.key"]).toBe(
            "existing",
        );
        expect(paymentInitial(initial, form, true)["config.currency"]).toBe(
            "CNY",
        );
        expect(
            paymentPayload(
                paymentInitial(initial, form, true),
                form,
                "Paytaro",
                initial,
            ).config.custom,
        ).toBe("keep");
    });
    it("does not carry credentials or extensions into a different gateway", () => {
        const initial = {
            payment: "Old",
            config: { key: "old-secret", custom: "old" },
        };
        const changed = paymentInitial(initial, form, false);
        expect(changed["config.key"]).toBe("");
        expect(paymentPayload(changed, form, "New", initial).config).toEqual({
            key: "",
            currency: "CNY",
        });
    });
});

it('keeps channel currency separate from provider credentials and preserves old CNY defaults',()=>{
 expect(paymentInitial({}, {},false).currency).toBe('CNY');
 expect(paymentPayload({name:'USD checkout',currency:'USD'}, {},'StripeCheckout',{})).toMatchObject({currency:'USD',payment:'StripeCheckout',config:{}});
});

describe("payment icon selection", () => {
    it("stores crypto metadata, uses coin icons, and restores editable defaults", () => {
        const checkoutCategory = { category: "crypto", asset: "USDT", network: "tron", networkName: "TRON (TRC20)", networkIcon: "" };
        const saved = paymentPayload({ iconPreset: "card", icon: "", checkoutCategory }, {}, "PaytaroQR", {});
        expect(saved.config._console_checkout).toEqual(checkoutCategory);
        expect(saved.icon).toBe("/payment-icons/crypto-usdt.svg");
        expect(paymentIconInitial(saved).icon).toBe("");
        expect(() => paymentPayload({ checkoutCategory: { ...checkoutCategory, network: "" } }, {}, "PaytaroQR", {})).toThrow();
        expect(paymentPayload({ iconPreset: "card", icon: "https://example.test/custom.png", checkoutCategory }, {}, "PaytaroQR", {}).icon).toBe("https://example.test/custom.png");
        expect(paymentPayload({ checkoutCategory: { category: "regular" } }, {}, "PaytaroQR", saved).config._console_checkout).toEqual({ category: "regular" });
    });
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
