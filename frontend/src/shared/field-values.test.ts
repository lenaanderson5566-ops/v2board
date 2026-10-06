import { describe, it, expect } from "vitest";
import { inputValue, apiValue } from "./field-values";
const price = { key: "month_price", label: "月付", scale: 100 };
describe("admin currency adapters", () => {
    it("loads cents as yuan and returns the same cents after editing", () => {
        expect(inputValue(price, 1999)).toBe(19.99);
        expect(apiValue(price, inputValue(price, 1999))).toBe(1999);
    });
    it("keeps zero prices and absent cycles distinct", () => {
        expect(inputValue(price, 0)).toBe(0);
        expect(inputValue(price, null)).toBeNull();
        expect(apiValue(price, null)).toBeNull();
        expect(apiValue(price, 0)).toBe(0);
    });
    it("rounds fractional inputs without float errors and refuses invalid amounts", () => {
        expect(apiValue(price, 19.9)).toBe(1990);
        expect(apiValue(price, 0.29)).toBe(29);
        expect(() => apiValue(price, Infinity)).toThrow();
    });
    it("does not scale percentages, bytes or IDs", () => {
        expect(apiValue({ key: "rate", label: "比例" }, 20)).toBe(20);
        expect(inputValue(undefined, true)).toBe(1);
    });
});

describe("comma separated configuration arrays", () => {
    const field = {
        key: "email_whitelist_suffix",
        label: "Domains",
        arrayText: true,
    };
    it("loads older comma separated values and submits array values", () => {
        expect(inputValue(field, "qq.com,gmail.com")).toEqual([
            "qq.com",
            "gmail.com",
        ]);
        expect(apiValue(field, [" qq.com", "gmail.com "])).toEqual([
            "qq.com",
            "gmail.com",
        ]);
    });
    it("clears an array without storing an empty item", () => {
        expect(apiValue(field, [""])).toEqual([]);
    });
});

describe("optional numeric prices", () => {
    const field = {
        key: "quarter_price",
        label: "Price",
        type: "number" as const,
        scale: 100,
    };
    it("preserves unavailable price cycles rather than enabling free cycles", () => {
        expect(apiValue(field, null)).toBeNull();
        expect(apiValue(field, "")).toBeNull();
    });
    it("keeps an explicitly free price distinct from an unavailable cycle", () => {
        expect(apiValue(field, "0")).toBe(0);
        expect(apiValue(field, "19.99")).toBe(1999);
    });
});
