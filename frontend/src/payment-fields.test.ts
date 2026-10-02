import { describe, it, expect } from "vitest";
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
