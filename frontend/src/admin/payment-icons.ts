import alipaySvg from "../../../public/payment-icons/alipay.svg?raw";
import wechatSvg from "../../../public/payment-icons/wechat.svg?raw";
import unionpaySvg from "../../../public/payment-icons/unionpay.svg?raw";
import cardSvg from "../../../public/payment-icons/card.svg?raw";
import paypalSvg from "../../../public/payment-icons/paypal.svg?raw";
import visaSvg from "../../../public/payment-icons/visa.svg?raw";
import mastercardSvg from "../../../public/payment-icons/mastercard.svg?raw";
import applepaySvg from "../../../public/payment-icons/applepay.svg?raw";
import googlepaySvg from "../../../public/payment-icons/googlepay.svg?raw";
import stripeSvg from "../../../public/payment-icons/stripe.svg?raw";
import usdtSvg from "../../../public/payment-icons/usdt.svg?raw";
import bitcoinSvg from "../../../public/payment-icons/bitcoin.svg?raw";

// Preview exactly the same vendored SVG files served to checkout.
const inlineSvg = (source: string) => `data:image/svg+xml,${encodeURIComponent(source)}`;

export const paymentIcons = [
    { id: "alipay", label: "支付宝", source: inlineSvg(alipaySvg) },
    { id: "wechat", label: "微信支付", source: inlineSvg(wechatSvg) },
    { id: "unionpay", label: "银联", source: inlineSvg(unionpaySvg) },
    { id: "card", label: "银行卡", source: inlineSvg(cardSvg) },
    { id: "paypal", label: "PayPal", source: inlineSvg(paypalSvg) },
    { id: "visa", label: "Visa", source: inlineSvg(visaSvg) },
    { id: "mastercard", label: "Mastercard", source: inlineSvg(mastercardSvg) },
    { id: "applepay", label: "Apple Pay", source: inlineSvg(applepaySvg) },
    { id: "googlepay", label: "Google Pay", source: inlineSvg(googlepaySvg) },
    { id: "stripe", label: "Stripe", source: inlineSvg(stripeSvg) },
    { id: "usdt", label: "USDT", source: inlineSvg(usdtSvg) },
    { id: "bitcoin", label: "Bitcoin", source: inlineSvg(bitcoinSvg) },
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
