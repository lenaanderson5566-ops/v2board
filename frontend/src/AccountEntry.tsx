import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Sparkles, Clock3, ShieldAlert } from "lucide-react";
import { e } from "./experience-copy";
import { tx } from "./i18n";
import { date, type Row } from "./api";
import { useData, State } from "./ui";

export function AccountEntry({
    state,
    subscription = {},
    onBack,
    support,
}: {
    state: "new" | "expired" | "banned";
    subscription?: Row;
    onBack?: () => void;
    support?: ReactNode;
}) {
    const [help, setHelp] = useState(false);
    const Icon =
        state === "banned"
            ? ShieldAlert
            : state === "expired"
              ? Clock3
              : Sparkles;
    return (
        <section className={`account-entry account-entry-${state}`}>
            <div className="entry-symbol">
                <Icon size={28} />
            </div>
            <h2>
                {e(
                    state === "new"
                        ? "newTitle"
                        : state === "expired"
                          ? "expiredTitle"
                          : "bannedTitle",
                )}
            </h2>
            <p>
                {e(
                    state === "new"
                        ? "newDetail"
                        : state === "expired"
                          ? "expiredDetail"
                          : "bannedDetail",
                )}
            </p>
            {state === "expired" && subscription.plan && (
                <div className="entry-previous">
                    <strong>{subscription.plan.name}</strong>
                    <span>
                        {tx("订阅到期")} · {date(subscription.expired_at)}
                    </span>
                </div>
            )}
            <div className="actions space">
                {state !== "banned" ? (
                    <>
                        <a className="button primary" href="#/plan">
                            {state === "new" ? tx("选择套餐") : e("renew")}
                            <ArrowUpRight size={16} />
                        </a>
                        <a className="button" href="#/knowledge">
                            {tx("使用文档")}
                        </a>
                        {state === "expired" && <a className="button" href="#/order">{tx("账单")}</a>}
                    </>
                ) : (
                    <>
                        {support && (
                            <button
                                className="primary"
                                onClick={() => setHelp(!help)}
                            >
                                {e("contactAdmin")}
                            </button>
                        )}
                        {onBack && (
                            <button onClick={onBack}>
                                {tx(support ? "退出登录" : "登录")}
                            </button>
                        )}
                    </>
                )}
            </div>
            {state === "new" && (
                <div className="entry-steps">
                    {[tx("选择套餐"), tx("一键导入"), tx("使用文档")].map(
                        (label, index) => (
                            <div key={label}>
                                <span>0{index + 1}</span>
                                <strong>{label}</strong>
                            </div>
                        ),
                    )}
                </div>
            )}
            {help && support && <div className="entry-support">{support}</div>}
        </section>
    );
}

export function UserStatusGate({
    children,
    logout,
    support,
    onStatus,
}: {
    children: ReactNode;
    logout: () => void;
    support: ReactNode;
    onStatus?: (user: import("./api").Row) => void;
}) {
    const info = useData("user/info");
    useEffect(() => {
        if (info.data) onStatus?.(info.data);
    }, [info.data, onStatus]);
    useEffect(() => {
        const poll = setInterval(() => {
            if (document.visibilityState === "visible") info.reload();
        }, 60000);
        return () => clearInterval(poll);
    }, []);
    useEffect(() => {
        const status = info.data?.account_status;
        if (status?.state !== "active" || info.data?.expired_at === null)
            return;
        const wait =
            (Number(info.data?.expired_at) - Number(status.server_time)) * 1000;
        if (wait <= 0) return;
        const timer = setTimeout(
            () => window.dispatchEvent(new Event("data-changed")),
            Math.min(wait + 250, 2147483647),
        );
        return () => clearTimeout(timer);
    }, [info.data]);
    if (!info.data)
        return (
            <State {...info} retry={info.reload}>
                <></>
            </State>
        );
    if (info.data?.account_status?.state === "banned")
        return (
            <div className="suspended-page">
                <AccountEntry
                    state="banned"
                    onBack={logout}
                    support={support}
                />
            </div>
        );
    return children;
}
