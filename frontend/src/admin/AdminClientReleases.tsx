import { AdminClientMirrors } from "./AdminClientMirrors";
import { useEffect, useRef, useState } from "react";
import {
    RefreshCw,
    ExternalLink,
    Package,
    CheckCircle2,
    AlertCircle,
} from "lucide-react";
import { ops, request, rows, date, type Row } from "../shared/api";
import { useData, State, Modal } from "../shared/ui";

export function AdminClientReleases() {
    const d = useData<Row[]>(ops("client/releases/fetch"));
    const [busy, setBusy] = useState(""),
        [message, setMessage] = useState(""),
        [notes, setNotes] = useState<Row | null>(null);
    const cancelled = useRef(false),
        active = useRef<AbortController | null>(null);
    useEffect(
        () => () => {
            cancelled.current = true;
            active.current?.abort();
        },
        [],
    );
    const clients = rows(d.data);
    async function check(ids: string[]) {
        setMessage("");
        cancelled.current = false;
        let failed = 0;
        try {
            for (const id of ids) {
                if (cancelled.current) break;
                setBusy(id);
                const controller = new AbortController();
                active.current = controller;
                const timeout = setTimeout(() => controller.abort(), 15000);
                try {
                    const res = await request<Row[]>(
                        ops("client/releases/check"),
                        { id },
                        { signal: controller.signal },
                    );
                    if (rows(res.data).find((r) => r.id === id)?.error)
                        failed++;
                } catch {
                    failed++;
                } finally {
                    clearTimeout(timeout);
                }
            }
            setMessage(
                cancelled.current
                    ? "已停止检查，可稍后继续。"
                    : failed
                      ? `检查完成，${failed} 个项目未能更新，已保留上次结果。`
                      : "检查完成。每个项目 5 分钟内使用缓存。",
            );
        } finally {
            setBusy("");
            d.reload();
        }
    }
    return (
        <div className="release-monitor">
            <div className="release-hero">
                <div>
                    <span className="release-eyebrow">CLIENT UPDATES</span>
                    <h2>客户端更新</h2>
                    <p>每 6 小时检查官方稳定版，及时掌握客户端与内核变化。</p>
                </div>
                <button
                    disabled={!!busy}
                    onClick={() => check(clients.map((r) => r.id))}
                >
                    <RefreshCw size={16} />
                    {busy ? "检查中…" : "检查全部"}
                </button>
            </div>
            <div className="release-summary">
                <span>
                    <strong>{clients.length}</strong> 个项目
                </span>
                <span>
                    <strong>
                        {clients.filter((r) => !r.stale && !r.error).length}
                    </strong>{" "}
                    个检查正常
                </span>
                <span>最新版本需验证兼容性后再推荐给用户</span>
            </div>
            {busy && (
                <button
                    onClick={() => {
                        cancelled.current = true;
                        active.current?.abort();
                    }}
                >
                    停止检查
                </button>
            )}
            {message && (
                <p className="release-message" role="status">
                    {message}
                </p>
            )}
            <State {...d} retry={d.reload}>
                <div className="release-grid">
                    {clients.map((client) => (
                        <article className="release-card" key={client.id}>
                            <header>
                                <div className="release-icon">
                                    <Package size={23} />
                                </div>
                                <div>
                                    <h3>{client.name}</h3>
                                    <small>{client.platforms}</small>
                                </div>
                            </header>
                            <div className="release-version">
                                {client.version || "尚未检查"}
                                <span>{client.engine}</span>
                            </div>
                            <p className="release-status">
                                {client.error || client.stale ? (
                                    <AlertCircle size={15} />
                                ) : (
                                    <CheckCircle2 size={15} />
                                )}
                                {client.error ||
                                    (client.stale
                                        ? "等待检查 / 数据已过期"
                                        : "已获取稳定版")}
                            </p>
                            {client.previous_version && (
                                <p className="muted">
                                    此前版本 {client.previous_version}
                                </p>
                            )}
                            <dl>
                                <div>
                                    <dt>发布时间</dt>
                                    <dd>
                                        {client.published_at
                                            ? date(client.published_at)
                                            : "—"}
                                    </dd>
                                </div>
                                <div>
                                    <dt>检查成功</dt>
                                    <dd>
                                        {client.checked_at
                                            ? date(client.checked_at)
                                            : "—"}
                                    </dd>
                                </div>
                            </dl>
                            <footer>
                                <button
                                    disabled={!!busy}
                                    onClick={() => check([client.id])}
                                >
                                    {busy === client.id
                                        ? "检查中…"
                                        : "检查更新"}
                                </button>
                                <button
                                    disabled={!client.version}
                                    onClick={() => setNotes(client)}
                                >
                                    更新说明
                                </button>
                                <a
                                    href={client.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`${client.name} 官方发布页`}
                                >
                                    <ExternalLink size={17} />
                                </a>
                            </footer>
                        </article>
                    ))}
                </div>
            </State>
            <AdminClientMirrors clients={clients} checking={!!busy} checkUpdates={()=>check(clients.filter(c=>["cmfa","clash-verge","flclash","sing-box"].includes(c.id)).map(c=>c.id))} />
            {notes && (
                <Modal
                    title={`${notes.name} ${notes.version}`}
                    close={() => setNotes(null)}
                >
                    <pre className="release-notes">
                        {notes.notes || "此版本未提供更新说明。"}
                    </pre>
                    <a
                        className="button"
                        href={notes.url}
                        target="_blank"
                        rel="noreferrer"
                    >
                        官方发布页
                    </a>
                </Modal>
            )}
        </div>
    );
}
