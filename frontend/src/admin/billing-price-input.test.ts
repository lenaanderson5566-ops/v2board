import { expect, it } from "vitest";
import { parseUsdPrice } from "./billing-price-input";

it("preserves cents exactly and distinguishes unavailable prices from free prices", () => {
    expect(parseUsdPrice("")).toBeNull();
    expect(parseUsdPrice("  ")).toBeNull();
    expect(parseUsdPrice("0")).toBe(0);
    expect(parseUsdPrice("10.09")).toBe(1009);
    expect(parseUsdPrice("0.29")).toBe(29);
    expect(parseUsdPrice("1.1")).toBe(110);
    expect(parseUsdPrice("10000000")).toBe(1_000_000_000);
});
it.each([
    "-1",
    "1.009",
    "1e3",
    "NaN",
    "Infinity",
    "10,000",
    "10000000.01",
    "9007199254740993",
])(
    "rejects invalid price %s rather than rounding or changing its meaning",
    (value) => {
        expect(() => parseUsdPrice(value)).toThrow();
    },
);
