import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";
import { supportedClients } from "../shared/import-links";
import { AdminClientReleases } from "./AdminClientReleases";
import { ResourcePage, resources } from "./admin";

function Recommendations({ saved }: { saved: () => void }) {
    const d = useData<Row>(admin("config/fetch"));
    const [changes, setChanges] = useState<Row>({});
    const [busy, setBusy] = useState(false),
        [message, setMessage] = useState("");
    const platforms = {
        android: "Android",
        windows: "Windows",
        macos: "macOS",
        linux: "Linux",
        ios: "iOS",
    } as const;
    return (
        <section className="release-card">
            <h3>用户端推荐</h3>
            <p className="muted">
                选择主推荐和备选；智能同步与配置中心使用相同推荐规则。禁用的客户端不会自动上架。
            </p>
            <State {...d} retry={d.reload}>
                <div className="release-grid">
                    {Object.entries(platforms).map(([os, label]) => (
                        <div key={os}>
                            <strong>{label}</strong>
                            {["primary", "secondary"].map((kind, index) => {
                                const key = `client_${kind}_${os}`;
                                return (
                                    <label
                                        key={key}
                                        style={{
                                            display: "block",
                                            marginTop: 8,
                                        }}
                                    >
                                        {index === 0 ? "主推荐" : "备选"}
                                        <select
                                            disabled={busy}
                                            aria-label={`${label} ${index === 0 ? "主推荐" : "备选"}`}
                                            value={
                                                changes[key] ??
                                                d.data?.app?.[key] ??
                                                ""
                                            }
                                            onChange={(e) =>
                                                setChanges({
                                                    ...changes,
                                                    [key]: e.target.value,
                                                })
                                            }
                                        >
                                            <option value="">
                                                使用默认推荐
                                            </option>
                                            {supportedClients(
                                                os as keyof typeof platforms,
                                            ).map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                );
                            })}
                        </div>
                    ))}
                </div>
                <button
                    disabled={busy || !Object.keys(changes).length}
                    onClick={async () => {
                        setBusy(true);
                        setMessage("");
                        try {
                            await request(admin("config/save"), changes);
                            setChanges({});
                            d.reload();
                            saved();
                            setMessage("推荐已保存，智能同步将使用新配置。");
                        } catch (e) {
                            setMessage((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    保存推荐
                </button>
                {message && <p role="status">{message}</p>}
            </State>
        </section>
    );
}

export function AdminClients({
    initialTab = "updates",
}: {
    initialTab?: "updates" | "policy";
}) {
    const [tab, setTab] = useState(initialTab);
    const [revision, setRevision] = useState(0);
    return (
        <div className="release-monitor">
            <h2>开源客户端管理</h2>
            <div className="section-tabs">
                <button
                    className={tab === "updates" ? "selected" : ""}
                    onClick={() => setTab("updates")}
                >
                    推荐与智能更新
                </button>
                <button
                    className={tab === "policy" ? "selected" : ""}
                    onClick={() => setTab("policy")}
                >
                    访问与版本策略
                </button>
            </div>
            {tab === "policy" ? (
                <>
                    <p className="muted">
                        策略用于订阅访问与自动发布。关闭客户端后不再智能下载或上架；最低版本会在下载完成时再次检查。24
                        小时订阅统计所有拉取请求（包括失败），不是设备数或限制额度。Mihomo
                        内核版本不能由应用版本推断，需要人工确认。
                    </p>
                    <p className="muted">
                        「允许订阅访问」即客户端白名单，未知 UA
                        始终拒绝。旧白名单限制会自动保留；首次保存后只使用此开关。各客户端独立准入，内核最低版本仍共同生效。UA
                        来源核对由人工维护；实际观测与版本识别率根据日志自动汇总，每分钟刷新，日志出现不代表真实客户端。UA
                        可伪造，限流与黑名单请在风控策略中设置。专用客户端使用独立认证入口。
                    </p>
                    <ResourcePage resource={resources.clients} />
                </>
            ) : (
                <>
                    <Recommendations saved={() => setRevision((v) => v + 1)} />
                    <AdminClientReleases key={revision} />
                </>
            )}
        </div>
    );
}
