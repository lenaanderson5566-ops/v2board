import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";

export function AdminSubscriptionProtection() {
    const d = useData<Row>(admin("config/fetch"));
    const [changes, setChanges] = useState<Row>({});
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    return (
        <section className="release-card">
            <h3>订阅访问拦截</h3>
            <p className="muted">
                这里的限流与 IP / UA
                黑名单会实际拦截请求。下方异常检测规则仅记录风险事件；关闭记录不影响拦截。客户端准入与最低版本统一在「第三方客户端管理
                → 访问与版本策略」设置。
            </p>{" "}
            <State {...d} retry={d.reload}>
                <div className="release-grid">
                    {(
                        [
                            [
                                "subscription_ip_minute_limit",
                                "每 IP 每分钟上限",
                                120,
                                10000,
                            ],
                            [
                                "subscription_user_minute_limit",
                                "每账号每分钟上限",
                                30,
                                1000,
                            ],
                            [
                                "subscription_user_day_limit",
                                "每账号 24 小时窗口上限",
                                240,
                                100000,
                            ],
                        ] as const
                    ).map(([key, label, fallback, max]) => (
                        <label key={key}>
                            {label}
                            <input
                                type="number"
                                min={1}
                                max={max}
                                disabled={busy}
                                value={
                                    changes[key] ??
                                    d.data?.app?.[key] ??
                                    fallback
                                }
                                onChange={(e) =>
                                    setChanges({
                                        ...changes,
                                        [key]:
                                            e.target.value === ""
                                                ? ""
                                                : Number(e.target.value),
                                    })
                                }
                            />
                        </label>
                    ))}
                </div>
                <p className="muted">
                    固定窗口从首次请求起计时，账号额度跨 IP、UA
                    和配置接口累计。超限返回 429 和重试等待时间；IP/UA
                    黑名单优先拒绝。
                </p>
                <button
                    disabled={busy || !Object.keys(changes).length}
                    onClick={async () => {
                        setBusy(true);
                        setMessage("");
                        try {
                            await request(admin("config/save"), changes);
                            d.reload();
                            setChanges({});
                            setMessage("访问策略已保存");
                        } catch (e) {
                            setMessage((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    保存访问策略
                </button>
                {message && <p role="status">{message}</p>}
            </State>
        </section>
    );
}
