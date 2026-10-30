import type { Boot } from "./api";
import { checkoutOrderReference, purchaseCouponId, purchasePeriod, purchasePlanId, ticketOrderReference } from "./navigation-intent";
export type BrowserPolicy = "allow" | "prompt" | "guide";
export function browserPolicy(
    embedded: string | null,
    policies?: Boot["browserPolicies"],
): BrowserPolicy {
    if (!embedded) return "allow";
    const keys: Record<string, keyof NonNullable<Boot["browserPolicies"]>> = { WeChat: "wechat", QQ: "qq", Weibo: "weibo", Other: "other", xiaohongshu: "xiaohongshu", douyin: "douyin", bilibili: "bilibili", alipay: "alipay", dingtalk: "dingtalk", wecom: "wecom" };
    const key = keys[embedded];
    if (!key) return "allow";
    const value = policies?.[key];
    return value && ["allow", "prompt", "guide"].includes(value)
        ? value
        : !["wechat", "qq", "weibo", "wecom"].includes(key)
          ? "allow"
          : "guide";
}
// Navigation references convey intent only; the destination must authenticate,
// re-read ownership and quote again. Never transfer login/payment proofs.
export function browserHandoffUrl(href: string): string {
    let url: URL;
    try { url = new URL(href); } catch { return ""; }
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    const hash = url.hash.slice(1);
    const [path, query] = hash.split("?");
    const planMatch = /^\/plan\/([1-9]\d*)$/.exec(path);
    const planDetail = Boolean(planMatch && purchasePlanId(planMatch[1]));
    const ticketOrder = ticketOrderReference(path.slice(1));
    const allowed = /^\/(?:login|register|forget|dashboard|overview|plan|activities|coupons|subscribe|knowledge|profile|security|invite|traffic|notifications|ticket|order(?:\/[a-zA-Z0-9_-]{1,64})?)?$/.test(path) || planDetail || Boolean(ticketOrder);
    const source = new URLSearchParams(query);
    const single = (key: string) => source.getAll(key).length === 1 ? source.get(key) : null;
    const params = new URLSearchParams();
    const code = source.has("code") ? single("code")
        : url.searchParams.getAll("code").length === 1 ? url.searchParams.get("code") : null;
    if ((!hash || allowed) && code && /^[a-zA-Z0-9_-]{1,64}$/.test(code)) params.set("code", code);
    if (path === "/plan" || planDetail) {
        const order = planDetail ? checkoutOrderReference(single("order")) : undefined;
        if (order) {
            params.set("order", order);
        } else {
            const period = purchasePeriod(single("period"));
            const couponId = purchaseCouponId(single("couponId"));
            const replace = planDetail ? checkoutOrderReference(single("replace")) : undefined;
            if (period) params.set("period", period);
            const selectedPlan = path === "/plan" ? purchasePlanId(single("selected")) : undefined;
            if (selectedPlan) params.set("selected", String(selectedPlan));
            if (couponId) params.set("couponId", String(couponId));
            if (replace) params.set("replace", replace);
        }
    }
    // Invitation registration requires this pair; neither is sent to telemetry.
    const invitation = single("invitation");
    const email = single("email");
    if (
        path === "/register" &&
        invitation &&
        /^[a-f0-9]{64}$/.test(invitation) &&
        email &&
        email.length <= 254 &&
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ) {
        params.set("invitation", invitation);
        params.set("email", email);
    }
    url.search = "";
    url.hash = hash
        ? (allowed ? path : "/login") +
          (params.size ? "?" + params : "")
        : "";
    if (!hash && params.size) url.search = params.toString();
    return url.href;
}

// Use the same sanitized handoff for post-login navigation. Auth screens and
// rejected routes must never turn into a return target or transfer a proof.
export function browserReturnPath(href: string): string | undefined {
    const address = browserHandoffUrl(href);
    if (!address) return;
    const hash = new URL(address).hash.slice(1);
    const path = hash.split("?")[0];
    if (!path || path === "/" || /^\/(?:login|register|forget)$/.test(path)) return;
    return hash.slice(1);
}
