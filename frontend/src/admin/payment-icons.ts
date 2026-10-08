// Inline previews and stable server assets keep saved icon URLs within the database limit.
const svg = (content: string, background: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><rect width="96" height="64" rx="12" fill="${background}"/>${content}</svg>`)}`;
const word = (label: string, color: string, background: string, size = 22) =>
    svg(`<text x="48" y="40" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="${size}" fill="${color}">${label}</text>`, background);

export const paymentIcons = [
    { id: "alipay", label: "支付宝", source: word("支", "white", "#1677ff", 44) },
    { id: "wechat", label: "微信支付", source: svg('<path d="M42 14c-15 0-27 9-27 21 0 6 3 11 9 15l-3 8 11-5c3 1 7 2 10 2 15 0 27-9 27-20S57 14 42 14Z" fill="white"/><path d="M62 29c-12 0-22 7-22 17s10 17 22 17c3 0 6-1 8-2l9 4-2-7c5-3 7-7 7-12 0-10-10-17-22-17Z" fill="white" stroke="#07c160" stroke-width="3"/><g fill="#07c160"><circle cx="32" cy="30" r="3"/><circle cx="51" cy="30" r="3"/><circle cx="55" cy="43" r="2.5"/><circle cx="70" cy="43" r="2.5"/></g>', "#07c160") },
    { id: "unionpay", label: "银联", source: svg('<path d="M15 12h26L28 52H2Z" fill="#e21836"/><path d="M41 12h26L54 52H28Z" fill="#00447c"/><path d="M67 12h26L80 52H54Z" fill="#007b84"/><text x="47" y="41" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="24" fill="white">银联</text>', "#f5f5f5") },
    { id: "card", label: "银行卡", source: svg('<rect x="14" y="12" width="68" height="42" rx="6" fill="#475569"/><path d="M14 23h68" stroke="#cbd5e1" stroke-width="9"/><rect x="23" y="38" width="15" height="8" rx="2" fill="#fbbf24"/>', "#f1f5f9") },
    { id: "paypal", label: "PayPal", source: word("PayPal", "#003087", "#eef7ff", 23) },
    { id: "visa", label: "Visa", source: word("VISA", "#1434cb", "#f5f7ff", 32) },
    { id: "mastercard", label: "Mastercard", source: svg('<circle cx="36" cy="32" r="22" fill="#eb001b"/><circle cx="60" cy="32" r="22" fill="#f79e1b" fill-opacity=".9"/>', "#fafafa") },
    { id: "applepay", label: "Apple Pay", source: word("Apple Pay", "#111", "#f5f5f5", 17) },
    { id: "googlepay", label: "Google Pay", source: word("G Pay", "#4285f4", "#f5f5f5", 24) },
    { id: "stripe", label: "Stripe", source: word("stripe", "#635bff", "#f3f1ff", 26) },
    { id: "usdt", label: "USDT", source: word("₮", "white", "#26a17b", 44) },
    { id: "bitcoin", label: "Bitcoin", source: word("₿", "white", "#f7931a", 44) },
];

export function paymentIconInitial(initial: Record<string, any>) {
    const saved = paymentIcons.find((item) => `/payment-icons/${item.id}.svg` === initial.icon);
    return {
        ...initial,
        icon: saved ? "" : initial.icon || "",
        iconPreset: initial.config?._console_icon || saved?.id || "card",
    };
}

export function resolvePaymentIcon(url: unknown, preset: unknown): string {
    return (typeof url === "string" ? url.trim() : "") ||
        (paymentIcons.some((item) => item.id === preset) ? `/payment-icons/${preset}.svg` : "");
}
