import { boot } from "../shared/api";
import { tx } from "../shared/i18n";
import { emailDomains } from "./registration-policy";
export function RegistrationDomains() {
    if (!boot.emailWhitelistEnabled) return null;
    const domains = emailDomains();
    return (
        <div className="auth-policy auth-domain-policy">
            {domains.length ? (
                <details open={domains.length <= 4}>
                    <summary>{tx("允许注册的邮箱")}</summary>
                    <div className="auth-domain-chips" dir="ltr">
                        {domains.map((d) => (
                            <span key={d}>@{d}</span>
                        ))}
                    </div>
                </details>
            ) : (
                <p>{tx("当前未配置可用的邮箱域名，请联系管理员。")}</p>
            )}
        </div>
    );
}
