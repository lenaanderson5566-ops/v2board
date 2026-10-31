import { Copy, Eye, EyeOff, ShieldAlert } from "lucide-react";
import "./apple-accounts.css";
import { StatusBadge } from "../shared/StatusBadge";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { tx } from "../shared/i18n";
import { request, date } from "../shared/api";
import { Modal } from "../shared/ui";
import { useRetryCountdown } from "../shared/use-retry-countdown";

type Account = { username: string; password?: string; available?: boolean; status?: string; region_display?: string; last_check?: string | number };
// Retain only a rate-limit deadline when this on-demand panel is reopened.
// Account credentials remain local to the mounted panel.
let accountRetryAt = 0;

export function AppleAccounts() {
    const { t } = useTranslation("appleAccount");
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>{t("0")}</button>{open && <Modal title={t("0")} className="apple-accounts-modal" close={() => setOpen(false)}><div className="pad"><AccountList /></div></Modal>}</>;
}

export function AccountList({ showNotice = true }: { showNotice?: boolean } = {}) {
    const { t } = useTranslation("appleAccount");
    const [attempt, setAttempt] = useState(0);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<"temporary" | "eligibility" | "limited" | null>(null);
    const [retryAt, setRetryAt] = useState(() => accountRetryAt);
    const retryIn = useRetryCountdown(retryAt);
    const copyGeneration = useRef(0);
    const [visible, setVisible] = useState<Record<number, boolean>>({});
    const [feedback, setFeedback] = useState("");
    useEffect(() => {
        copyGeneration.current += 1;
        setBusy(true); setError(null); setAccounts([]); setVisible({}); setFeedback("");
        if (accountRetryAt > Date.now()) {
            setRetryAt(accountRetryAt); setError("limited"); setBusy(false);
            return;
        }
        const controller = new AbortController();
        const deadline = window.setTimeout(() => controller.abort(), 20000);
        let active = true;
        request<Account[]>("user/apple-account", undefined, { signal: controller.signal })
            .then(result => { if (active) {setAccounts(result.data);accountRetryAt=0;setRetryAt(0);} })
            .catch((cause: Error & { status?: number; code?: string; retryAfter?: number }) => {
                if (!active) return;
                setError(cause.status === 429 ? "limited" : cause.status === 403 && cause.code !== "ACCOUNT_BANNED" ? "eligibility" : "temporary");
                accountRetryAt = cause.status === 429 ? Date.now() + Math.max(1, Number(cause.retryAfter) || 60) * 1000 : 0;
                setRetryAt(accountRetryAt);
            })
            .finally(() => { window.clearTimeout(deadline); if (active) setBusy(false); });
        return () => { active = false; copyGeneration.current += 1; window.clearTimeout(deadline); controller.abort(); };
    }, [attempt]);
    async function copy(value: string) {
        const generation=++copyGeneration.current;
        try { await navigator.clipboard.writeText(value); if(generation===copyGeneration.current)setFeedback("10"); }
        catch { if(generation===copyGeneration.current)setFeedback("11"); }
    }
    return <div className="apple-account-panel" aria-busy={busy}>
        {showNotice && <p className="apple-account-notice"><ShieldAlert size={18} aria-hidden="true" /><span>{t("1")}</span></p>}
        {busy ? <p role="status">{t("2")}</p> : error ? <div role="alert"><p>{error === "limited" ? tx("操作过于频繁，请稍后重试。") : error === "eligibility" ? tx("eligibility", {ns:"iosDownload"}) : t("unavailable", {defaultValue:"Download accounts are temporarily unavailable. Please try again later."})}</p>{error === "eligibility" && <div className="actions"><a href="#/plan">{tx("选择套餐")}</a><a href="#/traffic">{tx("buy", {ns:"credits"})}</a></div>}</div> : accounts.length === 0 ? <p>{t("4")}</p> : <div className="apple-account-list">{accounts.map((account, index) => {
            const usable = Boolean(account.available && account.password);
            return <section key={index} className="apple-account-card">
                <div className="apple-account-heading"><strong>{account.region_display || "App Store"}</strong><StatusBadge tone={usable ? "success" : account.status === "disabled" ? "neutral" : "warning"}>{tx(usable ? "正常" : account.status === "disabled" ? "已停用" : "暂不可用")}</StatusBadge></div>
                <dl className="apple-account-fields">
                    <div className="apple-account-field">
                        <dt>{t("username", { defaultValue: "Account" })}</dt>
                        <dd><bdi dir="ltr">{account.username}</bdi>{usable && <button type="button" onClick={() => copy(account.username)}><Copy size={15} aria-hidden="true" />{t("6")}</button>}</dd>
                    </div>
                    {usable && <div className="apple-account-field">
                        <dt>{tx("密码")}</dt>
                        <dd><span className="apple-account-password" dir="ltr">{visible[index] ? account.password : "••••••••"}</span><span className="apple-account-field-actions"><button type="button" className="apple-account-reveal" aria-label={t(visible[index] ? "9" : "8")} aria-pressed={Boolean(visible[index])} onClick={() => setVisible(previous => ({ ...previous, [index]: !previous[index] }))}>{visible[index] ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button><button type="button" onClick={() => copy(account.password!)}><Copy size={15} aria-hidden="true" />{t("7")}</button></span></dd>
                    </div>}
                </dl>
                {account.last_check && <p className="apple-account-checked muted">{t("12")}: {date(account.last_check)}</p>}
            </section>;
        })}</div>}
        {!busy && (error || accounts.length === 0) && <button disabled={retryIn > 0} onClick={() => {if(retryAt>Date.now())return;setAttempt(value => value + 1);}}>{retryIn > 0 ? tx("retryIn", {ns:"pricing", seconds:retryIn}) : t("5")}</button>}
        <p className="apple-account-feedback" role="status" aria-live="polite">{feedback && t(feedback)}</p>
    </div>;
}
