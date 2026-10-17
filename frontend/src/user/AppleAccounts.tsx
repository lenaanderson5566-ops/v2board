import { StatusBadge } from "../shared/StatusBadge";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { tx } from "../shared/i18n";
import { request, date } from "../shared/api";
import { Modal } from "../shared/ui";

type Account = { username: string; password?: string; available?: boolean; status?: string; region_display?: string; last_check?: string | number };

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
    const [error, setError] = useState(false);
    const [visible, setVisible] = useState<Record<number, boolean>>({});
    const [feedback, setFeedback] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        const deadline = window.setTimeout(() => controller.abort(), 20000);
        let active = true;
        setBusy(true); setError(false); setAccounts([]); setVisible({});
        request<Account[]>("user/apple-account", undefined, { signal: controller.signal })
            .then(result => { if (active) setAccounts(result.data); })
            .catch(() => { if (active) setError(true); })
            .finally(() => { window.clearTimeout(deadline); if (active) setBusy(false); });
        return () => { active = false; window.clearTimeout(deadline); controller.abort(); };
    }, [attempt]);
    async function copy(value: string) {
        try { await navigator.clipboard.writeText(value); setFeedback("10"); }
        catch { setFeedback("11"); }
    }
    return <div className="pad">
        <p>{t("1")}</p>
        {busy ? <p role="status">{t("2")}</p> : error ? <p role="alert">{t("3")}</p> : accounts.length === 0 ? <p>{t("4")}</p> : accounts.map((account, index) => <section key={index} className="apple-account-card">
            <div className="apple-account-heading"><strong>{account.region_display || "App Store"}</strong><StatusBadge tone={account.available ? "success" : account.status === "disabled" ? "neutral" : "warning"}>{tx(account.available ? "正常" : account.status === "disabled" ? "已停用" : "暂不可用")}</StatusBadge></div>
            <p dir="ltr">{account.username}</p>
            <p className="apple-account-password" dir="ltr">{account.available && (visible[index] ? account.password : "••••••••")}</p>
            {account.available && account.password && <div className="quick-actions"><button onClick={() => copy(account.username)}>{t("6")}</button><button onClick={() => copy(account.password!)}>{t("7")}</button><button onClick={() => setVisible(previous => ({ ...previous, [index]: !previous[index] }))}>{t(visible[index] ? "9" : "8")}</button></div>}
            {account.last_check && <p className="muted">{t("12")}: {typeof account.last_check === 'number' ? date(account.last_check) : account.last_check}</p>}
        </section>)}
        {!busy && (error || accounts.length === 0) && <button onClick={() => setAttempt(value => value + 1)}>{t("5")}</button>}
        <p role="status">{feedback && t(feedback)}</p>
    </div>;
}
