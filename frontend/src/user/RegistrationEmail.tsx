import { tx } from "../shared/i18n";
import { emailDomains } from "./registration-policy";

/** Accept pasted full addresses without silently changing their destination. */
export function RegistrationEmail({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const domains = emailDomains();
    const separator = value.indexOf("@");
    const username = separator < 0 ? value : value.slice(0, separator);
    const domain = separator < 0 ? domains[0] || "" : value.slice(separator + 1).toLowerCase();
    return <div className="auth-field">
        <label htmlFor="registration-email-name">{tx("邮箱地址")}</label>
        <div className="auth-email-selector" dir="ltr">
            <input id="registration-email-name" type="text" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required value={username}
                onChange={(event) => {
                    const next = event.target.value.trim();
                    onChange(next.includes("@") ? next : `${next}@${domain}`);
                }} placeholder="you" />
            <select aria-label={tx("邮箱后缀")} value={domain} onChange={(event) => onChange(`${username}@${event.target.value}`)}>
                {!domains.includes(domain) && <option value={domain} disabled>@{domain}</option>}
                {domains.map((item) => <option key={item} value={item}>@{item}</option>)}
            </select>
        </div>
    </div>;
}
