import { MailX, Plus, Search } from "lucide-react";
import { Pager, Empty } from "../shared/ui";
import { useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { formatInstant } from "../shared/timezone";

const actions: Record<string, string> = {
    add: "加入禁发",
    reactivate: "重新禁发",
    note: "修改备注",
    release: "解除人工禁发",
};
export function AdminMailBlocklist() {
    const [pageSize, setPageSize] = useState(20);
    const [query, setQuery] = useState(""),
        [emailFilter, setEmailFilter] = useState(""),
        [state, setState] = useState("active"),
        [page, setPage] = useState(1);
    const [email, setEmail] = useState(""),
        [note, setNote] = useState(""),
        [editing, setEditing] = useState<Row | null>(null),
        [editNote, setEditNote] = useState("");
    const [history, setHistory] = useState<Row | null>(null),
        [historyPage, setHistoryPage] = useState(1),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [historySize, setHistorySize] = useState(20);
    const [bulk, setBulk] = useState(false);
    const [result, setResult] = useState("");
    const lock = useRef(false);
    const list = useData<Row[]>(
        admin(
            `mail-blocklist/fetch?current=${page}&page_size=${pageSize}&state=${state}&email=${encodeURIComponent(emailFilter)}`,
        ),
    );
    const audit = useData<Row[]>(
        history
            ? admin(
                  `mail-blocklist/history?recipient_hash=${history.recipient_hash}&current=${historyPage}&page_size=${historySize}`,
              )
            : "",
    );
    async function mutate(path: string, body: Row, done: (data: Row) => void) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        setResult("");
        try {
            const response = await request(admin(path), body);
            done(response.data);
            list.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return (
        <section className="mail-blocklist">
            <div className="mail-blocklist-intro">
                <span className="mail-blocklist-icon">
                    <MailX size={20} aria-hidden />
                </span>
                <div>
                    <h3>管理邮件发送权限</h3>
                    <p className="muted">
                        仅允许添加尚未注册的邮箱。禁发后，该邮箱将收不到任何邮件，包括注册验证码和密码找回邮件。
                    </p>
                    <details>
                        <summary>了解禁发范围与解除规则</summary>
                        <p className="muted">
                            按完整邮箱匹配，覆盖工单、账单、推广及测试邮件。用户页面保持原有响应。已交给服务商的邮件无法撤回；解除后不补发历史邮件，也不解除退信或投诉限制。
                        </p>
                    </details>
                </div>
            </div>
            <div className="mail-blocklist-mode">
                <button
                    type="button"
                    aria-pressed={!bulk}
                    disabled={busy}
                    onClick={() => {
                        setBulk(false);
                        setEmail("");
                        setError("");
                        setResult("");
                    }}
                >
                    单个添加
                </button>
                <button
                    type="button"
                    aria-pressed={bulk}
                    disabled={busy}
                    onClick={() => {
                        setBulk(true);
                        setEmail("");
                        setError("");
                        setResult("");
                    }}
                >
                    多行导入
                </button>
            </div>
            <form
                className="mail-blocklist-create"
                onSubmit={(e) => {
                    e.preventDefault();
                    const emails = email
                        .split(/\r?\n/)
                        .map((value) => value.trim())
                        .filter(Boolean);
                    if (bulk && emails.length > 200) {
                        setError("每次最多导入 200 行邮箱，请分批导入。");
                        return;
                    }
                    void mutate(
                        bulk ? "mail-blocklist/import" : "mail-blocklist/add",
                        bulk
                            ? { emails, note: note.trim() }
                            : { email: email.trim(), note: note.trim() },
                        (data) => {
                            setResult(
                                bulk
                                    ? `导入完成：新增或重新禁发 ${data.added} 个，现有用户跳过 ${data.existingUsers ?? 0} 个，已禁发跳过 ${data.skipped} 个，重复行 ${data.duplicates} 个。`
                                    : "已加入禁发名单。",
                            );
                            setEmail("");
                            setNote("");
                            setPage(1);
                            setState("active");
                            setEmailFilter("");
                            setQuery("");
                        },
                    );
                }}
            >
                <label>
                    {bulk ? "禁发邮箱（每行一个，最多 200 个）" : "禁发邮箱"}
                    {bulk ? (
                        <textarea
                            rows={6}
                            className="mail-blocklist-emails"
                            required
                            maxLength={52000}
                            disabled={busy}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={"alice@example.com\nbob@example.com"}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    ) : (
                        <input
                            type="email"
                            required
                            maxLength={254}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="off"
                            disabled={busy}
                        />
                    )}
                    {bulk && (
                        <small className="muted">
                            自动忽略空行及重复邮箱；现有用户不可导入，已禁发的邮箱保留原备注。已解除且未注册的邮箱将重新禁发，格式错误时整批不导入。
                        </small>
                    )}
                </label>
                <label>
                    禁发备注（选填）
                    <textarea
                        rows={2}
                        maxLength={1000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="记录禁发原因，勿填写密码、验证码或密钥"
                    />
                </label>
                <button className="primary" disabled={busy || !email.trim()}>
                    <Plus size={16} aria-hidden />{" "}
                    {busy ? "处理中…" : bulk ? "导入禁发名单" : "加入禁发名单"}
                </button>
            </form>
            {result && (
                <p className="pad" role="status">
                    {result}
                </p>
            )}
            {error && !editing && (
                <p className="pad" role="alert">
                    {error}
                </p>
            )}
            <form
                className="mail-blocklist-filters"
                onSubmit={(e) => {
                    e.preventDefault();
                    setEmailFilter(query.trim());
                    setPage(1);
                }}
            >
                <label>
                    精确查询邮箱
                    <input
                        type="email"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </label>
                <label>
                    名单状态
                    <select
                        value={state}
                        onChange={(e) => {
                            setState(e.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="active">禁发中</option>
                        <option value="released">已解除</option>
                        <option value="all">全部</option>
                    </select>
                </label>
                <button>
                    <Search size={16} aria-hidden /> 查询
                </button>
            </form>
            <State {...list} retry={list.reload}>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>邮箱</th>
                                <th>备注</th>
                                <th>状态</th>
                                <th>最后操作</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(list.data || []).map((row) => (
                                <tr key={row.recipient_hash}>
                                    <td>{row.email}</td>
                                    <td
                                        style={{
                                            whiteSpace: "pre-wrap",
                                            overflowWrap: "anywhere",
                                            maxWidth: 400,
                                        }}
                                    >
                                        {row.note || (
                                            <span className="muted">—</span>
                                        )}
                                    </td>
                                    <td>
                                        {row.released_at ? "已解除" : "禁发中"}
                                    </td>
                                    <td>
                                        {formatInstant(row.updated_at)} · 管理员
                                        #{row.administrator_id}
                                    </td>
                                    <td>
                                        <div className="actions">
                                            <button
                                                disabled={busy}
                                                onClick={() => {
                                                    setEditing(row);
                                                    setEditNote(row.note || "");
                                                    setError("");
                                                }}
                                            >
                                                编辑备注
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setHistory(row);
                                                    setHistoryPage(1);
                                                }}
                                            >
                                                操作记录
                                            </button>
                                            {!row.released_at && (
                                                <button
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (
                                                            window.confirm(
                                                                `解除 ${row.email} 的人工禁发？不会重发历史邮件，退信或投诉限制仍然有效。`,
                                                            )
                                                        )
                                                            void mutate(
                                                                "mail-blocklist/change",
                                                                {
                                                                    recipient_hash:
                                                                        row.recipient_hash,
                                                                    revision:
                                                                        row.revision,
                                                                    action: "release",
                                                                },
                                                                () => {},
                                                            );
                                                    }}
                                                >
                                                    解除禁发
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!list.data?.length && <Empty text="暂无匹配的禁发记录" />}
                </div>
            </State>
            <Pager
                size={pageSize}
                onSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                }}
                page={page}
                total={list.total}
                loading={list.loading}
                onChange={setPage}
            />
            {editing && (
                <Modal
                    title="编辑禁发备注"
                    close={() => {
                        if (!busy) setEditing(null);
                    }}
                >
                    <form
                        className="pad mail-blocklist-edit"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void mutate(
                                "mail-blocklist/change",
                                {
                                    recipient_hash: editing.recipient_hash,
                                    revision: editing.revision,
                                    action: "note",
                                    note: editNote.trim(),
                                },
                                () => setEditing(null),
                            );
                        }}
                    >
                        <p>{editing.email}</p>
                        <label>
                            备注（选填）
                            <textarea
                                rows={3}
                                maxLength={1000}
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                            />
                        </label>
                        {error && <p role="alert">{error}</p>}
                        <button disabled={busy}>保存备注</button>
                    </form>
                </Modal>
            )}
            {history && (
                <Modal title="禁发操作记录" close={() => setHistory(null)}>
                    <div className="pad">
                        <p>{history.email}</p>
                        <State {...audit} retry={audit.reload}>
                            {(audit.data || []).map((row) => (
                                <p key={row.id}>
                                    {formatInstant(row.created_at)} ·{" "}
                                    {actions[row.action] || row.action} · 管理员
                                    #{row.administrator_id}
                                </p>
                            ))}
                        </State>
                        <Pager
                            page={historyPage}
                            total={audit.total}
                            size={historySize}
                            loading={audit.loading}
                            onChange={setHistoryPage}
                            onSizeChange={(size) => {
                                setHistorySize(size);
                                setHistoryPage(1);
                            }}
                        />
                    </div>
                </Modal>
            )}
        </section>
    );
}
