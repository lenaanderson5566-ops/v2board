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
                        开启「允许订阅访问」，即可允许该行 UA 拉取订阅。按 UA
                        开头匹配，不区分大小写；未知或关闭的客户端拒绝访问。匹配后仍需有效订阅凭证。
                    </p>
                    <p className="muted">
                        展开「实际请求 UA」可查看近 30 天记录。24
                        小时请求包含成功和失败，每分钟刷新。只检查 UA
                        时，编辑中的最低版本留空。关闭后也会停止该客户端的推荐与自动上架。
                    </p>{" "}
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
