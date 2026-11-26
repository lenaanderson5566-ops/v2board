/** Convert decimal text to minor units without rounding extra decimals. */
function parseMinorAmount(value: string, limit: number, formatError: string, limitError: string): number | null {
    const text = value.trim();
    if (!text) return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(formatError);
    const [whole, fraction = ""] = text.split(".");
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(minor) || minor > limit) throw new Error(limitError);
    return minor;
}

export function parseUsdPrice(value: string): number | null {
    return parseMinorAmount(value, 1_000_000_000, "美元价格须为非负金额，最多保留两位小数。", "美元价格不能超过 10,000,000。");
}

export function parseRecordedPaymentAmount(value: string): number | null {
    return parseMinorAmount(value, Number.MAX_SAFE_INTEGER, "线下实收本金须为非负金额，最多保留两位小数。", "线下实收本金超出可记录范围。");
}
