// Only explicit gateway redirect actions may use web URLs or these wallet routes.
// QR payloads are opaque unless a provider-specific rule recognizes an official entry.
function cleanUrl(value: unknown): URL | undefined {
    if (
        typeof value !== "string" ||
        !value ||
        value.length > 8192 ||
        value.trim() !== value ||
        /[\\\x00-\x20\x7f]/.test(value)
    )
        return;
    try {
        const url = new URL(value);
        if (url.username || url.password) return;
        return url;
    } catch {
        return;
    }
}
function webUrl(value: unknown): URL | undefined {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return;
    const url = cleanUrl(value);
    return url && ["http:", "https:"].includes(url.protocol) && url.hostname
        ? url
        : undefined;
}
export function paymentActionUrl(value: unknown): string | undefined {
    const web = webUrl(value);
    if (web) return web.href;
    const url = cleanUrl(value);
    if (!url || url.port || url.hash) return;
    if (
        ["alipays:", "alipay:"].includes(url.protocol) &&
        url.hostname === "platformapi" &&
        url.pathname === "/startapp"
    ) {
        if (
            ["appId", "saId", "url", "qrcode"].some(
                (key) => url.searchParams.getAll(key).length > 1,
            )
        )
            return;
        if (url.searchParams.has("appId") && url.searchParams.has("saId"))
            return;
        const app =
            url.searchParams.get("appId") || url.searchParams.get("saId");
        if (!app || !/^\d{1,32}$/.test(app)) return;
        const nested = url.searchParams.get("url");
        if (nested !== null && !webUrl(nested)) return;
        const code = url.searchParams.get("qrcode");
        if (code !== null && !qrPaymentActionUrl(code, "AlipayF2F")) return;
        return url.href;
    }
    if (
        url.protocol === "weixin:" &&
        url.hostname === "wap" &&
        url.pathname === "/pay" &&
        Boolean(url.searchParams.get("prepayid"))
    )
        return url.href;
}
export function qrPaymentActionUrl(
    value: unknown,
    provider: string,
): string | undefined {
    if (
        !["AlipayF2F", "EPayQrcode", "PaytaroQR", "StripeAlipay"].includes(
            provider,
        )
    )
        return;
    const url = webUrl(value);
    if (
        !url ||
        url.protocol !== "https:" ||
        url.hostname !== "qr.alipay.com" ||
        url.port ||
        url.hash ||
        url.search ||
        !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)
    )
        return;
    return url.href;
}
export function nativeWechatQr(value: unknown): boolean {
    const url = cleanUrl(value);
    return Boolean(
        url &&
        url.protocol === "weixin:" &&
        url.hostname === "wxpay" &&
        url.pathname === "/bizpayurl" &&
        !url.port &&
        !url.hash &&
        url.searchParams.get("pr"),
    );
}
