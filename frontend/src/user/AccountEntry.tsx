import { useState, type ReactNode } from "react";
import { ArrowUpRight, Sparkles, Clock3, ShieldAlert } from "lucide-react";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import { date, type Row } from "../shared/api";
import { JourneyIllustration } from "./JourneyIllustration";

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
            {state === "new" && <JourneyIllustration />}
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
                        {tx("订阅到期")} · {date(subscription.expired_at, { second: undefined })}
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
                        {state === "expired" && (
                            <a className="button" href="#/order">
                                {tx("账单")}
                            </a>
                        )}
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
                    {[tx("选择套餐"), tx("确认与支付"), tx("配置中心")].map(
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
