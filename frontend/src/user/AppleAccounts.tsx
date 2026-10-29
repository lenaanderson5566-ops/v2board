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
    return <><button onClick={() => setOpen(true)}>{t("0")}</button>{open && <Modal title={t("0")} close={() => setOpen(false)}><AccountList /></Modal>}</>;
}

export function AccountList() {
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
    return <div className="pad">
        <p>{t("1")}</p>
        {busy ? <p role="status">{t("2")}</p> : error ? <div role="alert"><p>{error === "limited" ? tx("操作过于频繁，请稍后重试。") : error === "eligibility" ? tx("eligibility", {ns:"iosDownload"}) : t("unavailable", {defaultValue:"Download accounts are temporarily unavailable. Please try again later."})}</p>{error === "eligibility" && <div className="actions"><a href="#/plan">{tx("选择套餐")}</a><a href="#/traffic">{tx("buy", {ns:"credits"})}</a></div>}</div> : accounts.length === 0 ? <p>{t("4")}</p> : accounts.map((account, index) => <section key={index} className="apple-account-card">
            <div className="apple-account-heading"><strong>{account.region_display || "App Store"}</strong><StatusBadge tone={account.available ? "success" : account.status === "disabled" ? "neutral" : "warning"}>{tx(account.available ? "正常" : account.status === "disabled" ? "已停用" : "暂不可用")}</StatusBadge></div>
            <p dir="ltr">{account.username}</p>
            <p className="apple-account-password" dir="ltr">{account.available && (visible[index] ? account.password : "••••••••")}</p>
            {account.available && account.password && <div className="quick-actions"><button onClick={() => copy(account.username)}>{t("6")}</button><button onClick={() => copy(account.password!)}>{t("7")}</button><button onClick={() => setVisible(previous => ({ ...previous, [index]: !previous[index] }))}>{t(visible[index] ? "9" : "8")}</button></div>}
            {account.last_check && <p className="muted">{t("12")}: {typeof account.last_check === 'number' ? date(account.last_check) : account.last_check}</p>}
        </section>)}
        {!busy && (error || accounts.length === 0) && <button disabled={retryIn > 0} onClick={() => {if(retryAt>Date.now())return;setAttempt(value => value + 1);}}>{retryIn > 0 ? tx("retryIn", {ns:"pricing", seconds:retryIn}) : t("5")}</button>}
        <p role="status">{feedback && t(feedback)}</p>
    </div>;
}
