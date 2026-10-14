/** Convert decimal text to cents without silently rounding extra decimals. */
export function parseUsdPrice(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(text))
        throw new Error("美元价格须为非负金额，最多保留两位小数。");
    const [whole, fraction = ""] = text.split(".");
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(minor) || minor > 1_000_000_000)
        throw new Error("美元价格不能超过 10,000,000。");
    return minor;
}
