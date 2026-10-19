import type { Boot } from "./api";
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
        : !["wechat", "qq", "weibo"].includes(key)
          ? "allow"
          : "guide";
}
// Copy only public navigation and validated registration invitations; strip login and client authorization proofs.
export function browserHandoffUrl(href: string): string {
    const url = new URL(href);
    url.username = "";
    url.password = "";
    const hash = url.hash.slice(1);
    const [path, query] = hash.split("?");
    const allowed =
        /^\/(?:login|register|forget|dashboard|plan|activities|coupons|subscribe|knowledge|profile|security|invite|traffic|notifications|ticket|order(?:\/[a-zA-Z0-9_-]{1,64})?)?$/;
    const params = new URLSearchParams();
    const code =
        new URLSearchParams(query).get("code") ?? url.searchParams.get("code");
    if (code && /^[a-zA-Z0-9_-]{1,64}$/.test(code)) params.set("code", code);
    // Invitation registration requires this pair; neither is sent to telemetry.
    const invitation = new URLSearchParams(query).get("invitation");
    const email = new URLSearchParams(query).get("email");
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
        ? (allowed.test(path) ? path : "/login") +
          (params.size ? "?" + params : "")
        : "";
    if (!hash && params.size) url.search = params.toString();
    return url.href;
}
