import { boot } from "./api";
import { tx } from "./i18n";
export function emailDomains() {
    return [
        ...new Set(
            (boot.emailWhitelistSuffixes || [])
                .map((d) => d.trim().replace(/^@/, "").toLowerCase())
                .filter(Boolean),
        ),
    ];
}
export function registrationEmailError(email: string) {
    if (!boot.emailWhitelistEnabled) return "";
    const domains = emailDomains();
    if (!domains.length) return tx("当前未配置可用的邮箱域名，请联系管理员。");
    const parts = email.trim().toLowerCase().split("@");
    return parts.length === 2 && domains.includes(parts[1])
        ? ""
        : tx("此邮箱域名暂不支持注册，请使用允许的邮箱。");
}
