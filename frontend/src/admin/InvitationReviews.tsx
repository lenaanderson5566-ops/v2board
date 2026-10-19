import { TableViewport } from "../shared/ui";
import { useRef, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    CircleHelp,
    ShieldCheck,
    Users,
} from "lucide-react";
import {
    admin,
    date,
    money,
    query,
    readRequest,
    request,
    type Row,
} from "../shared/api";
import { ResourcePage } from "./admin";
import { Modal } from "../shared/ui";

const labels: Record<string, string> = {
    pending: "待人工复核",
    confirmed: "确认违规",
    false_positive: "排除疑似",
    insufficient: "证据不足",
    no_signal: "无需审核",
};
const conclusions = [
    {
        value: "false_positive",
        label: "排除疑似",
        help: "核验后未发现违规依据",
        Icon: CheckCircle2,
    },
    {
        value: "insufficient",
        label: "证据不足",
        help: "现有资料无法判断",
        Icon: CircleHelp,
    },
    {
        value: "confirmed",
        label: "确认违规",
        help: "有具体、已核实的违规依据",
        Icon: AlertCircle,
    },
];
const reasons: Record<string, string[]> = {
    false_positive: [
        "核验后未发现违反邀请规则的依据。",
        "仅客户端 UA 相同，没有其他同源证据。",
    ],
    insufficient: [
        "相同 IP 可能来自共享网络，现有证据不足以判断。",
        "历史注册资料不完整，暂时无法核实。",
        "需要进一步核验，暂不作违规认定。",
    ],
    confirmed: [],
};
function SignalBadge({ value, label }: { value: unknown; label?: string }) {
    const state =
        value === true ? "same" : value === false ? "different" : "missing";
    return (
        <span className={`invitation-signal invitation-signal-${state}`}>
            {label && `${label}：`}
            {state === "same"
                ? "相同"
                : state === "different"
                  ? "不同"
                  : "无记录"}
        </span>
    );
}
function EvidenceComparison({ row }: { row: Row }) {
    const from = Number(row.inviter_registered_at),
        to = Number(row.user_registered_at);
    const known =
        row.inviter_registered_at != null &&
        row.user_registered_at != null &&
        Number.isFinite(from) &&
        Number.isFinite(to);
    const seconds = to - from;
    const interval = !known
        ? "无记录"
        : seconds < 0
          ? "受邀用户早于邀请人注册，请核查历史数据"
          : seconds < 60
            ? "不足 1 分钟"
            : seconds < 3600
              ? `${Math.floor(seconds / 60)} 分钟`
              : seconds < 86400
                ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`
                : `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时`;
    return (
        <section className="invitation-evidence">
            <h3>注册来源对比</h3>
            <TableViewport>
                <table className="invitation-comparison">
                    <thead>
                        <tr>
                            <th>对比项</th>
                            <th>邀请人</th>
                            <th>受邀用户</th>
                            <th>比对结果</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[
                            {
                                label: "注册 IP",
                                value: row.signals?.sameRegistrationIp,
                            },
                            {
                                label: "注册 UA",
                                value: row.signals?.sameRegistrationUa,
                            },
                        ].map(({ label, value }) => (
                            <tr key={label}>
                                <th scope="row">{label}</th>
                                <td>
                                    {typeof value === "boolean"
                                        ? "注册摘要已参与比对"
                                        : "无法确认资料是否完整"}
                                </td>
                                <td>
                                    {typeof value === "boolean"
                                        ? "注册摘要已参与比对"
                                        : "无法确认资料是否完整"}
                                </td>
                                <td>
                                    <SignalBadge value={value} />
                                </td>
                            </tr>
                        ))}
                        <tr>
                            <th scope="row">注册时间</th>
                            <td>
                                {row.inviter_registered_at == null
                                    ? "无记录"
                                    : date(row.inviter_registered_at)}
                            </td>
                            <td>
                                {row.user_registered_at == null
                                    ? "无记录"
                                    : date(row.user_registered_at)}
                            </td>
                            <td>{interval}</td>
                        </tr>
                    </tbody>
                </table>
            </TableViewport>
            <p className="muted">
                IP、UA
                结果为受邀用户注册时的摘要比对，不是当前登录来源。系统未保存原始注册
                IP 或
                UA，无法显示地址、地区、浏览器或系统版本；无记录不代表不同。
            </p>
            <p className="muted">
                相同 IP 可能来自家庭、公司、校园网或代理出口；相同 UA
                可能来自相同客户端版本。时间接近也仅是辅助线索，不能据此单独认定自邀。
            </p>
        </section>
    );
}
function trigger(row: Row) {
    const s = row.signals || {};
    if (s.sameRegistrationIp === true)
        return s.sameRegistrationUa === true
            ? "注册 IP、UA 均相同"
            : "注册 IP 相同";
    if (s.sameRegistrationIp == null || s.sameRegistrationUa == null)
        return "注册资料不完整";
    return s.sameRegistrationUa === true ? "仅注册 UA 相同" : "未命中同源信号";
}
function availableReasons(state: string, row: Row) {
    return (reasons[state] || []).filter((text) => {
        if (text === "相同 IP 可能来自共享网络，现有证据不足以判断。")
            return row.signals?.sameRegistrationIp === true;
        if (text === "仅客户端 UA 相同，没有其他同源证据。")
            return (
                row.signals?.sameRegistrationIp === false &&
                row.signals?.sameRegistrationUa === true
            );
        if (text === "历史注册资料不完整，暂时无法核实。")
            return (
                row.signals?.sameRegistrationIp == null ||
                row.signals?.sameRegistrationUa == null
            );
        return true;
    });
}
const commissionText = (row: Row) =>
    row.commissions?.length
        ? row.commissions
              .map((item: Row) => money(item.amount, item.currency))
              .join(" / ")
        : "暂无关联佣金";
const resource = {
    title: "邀请异常复核",
    fetch: admin("invitation-review/fetch"),
    fields: [],
    create: false,
    serverSearch: true,
    columns: [
        ["email", "受邀用户", (r: Row) => r.email || `用户 #${r.user_id}`],
        [
            "inviter_email",
            "邀请人",
            (r: Row) => r.inviter_email || `用户 #${r.inviter_id}`,
        ],
        [
            "signals",
            "核查原因",
            (r: Row) => (
                <div className="invitation-signal-list">
                    <SignalBadge
                        label="IP"
                        value={r.signals?.sameRegistrationIp}
                    />
                    <SignalBadge
                        label="UA"
                        value={r.signals?.sameRegistrationUa}
                    />
                </div>
            ),
        ],
        [
            "invitation_counts",
            "邀请量 · 24 小时 / 7 天",
            (r: Row) =>
                r.invitation_counts
                    ? `${r.invitation_counts.last24Hours} / ${r.invitation_counts.last7Days}`
                    : "无记录",
        ],
        ["commissions", "订单佣金", commissionText],
        ["state", "审核状态", (r: Row) => labels[r.state] || "未知状态"],
        ["created_at", "记录时间", (r: Row) => date(r.created_at)],
    ] as Parameters<typeof ResourcePage>[0]["resource"]["columns"],
};
function Person({ row, inviter }: { row: Row; inviter: boolean }) {
    const prefix = inviter ? "inviter" : "user";
    const registered = row[`${prefix}_registered_at`];
    const banned = row[`${prefix}_banned`];
    const expiry = row[`${prefix}_expired_at`];
    const plan =
        row[`${prefix}_plan_name`] ||
        (row[`${prefix}_plan_id`] ? "套餐信息不可用" : "未设置套餐");
    return (
        <section className="invitation-person">
            <h3>
                <Users aria-hidden="true" />
                {inviter ? "邀请人" : "受邀用户"}
            </h3>
            <strong>
                {(inviter ? row.inviter_email : row.email) || "邮箱无记录"}
            </strong>
            <dl>
                <div>
                    <dt>用户 ID</dt>
                    <dd>#{row[`${prefix}_id`]}</dd>
                </div>
                <div>
                    <dt>注册时间</dt>
                    <dd>{registered == null ? "无记录" : date(registered)}</dd>
                </div>
                <div>
                    <dt>账号状态</dt>
                    <dd>
                        {banned == null
                            ? "无记录"
                            : Number(banned)
                              ? "已封禁"
                              : "正常"}
                    </dd>
                </div>
                <div>
                    <dt>当前套餐</dt>
                    <dd>{registered == null ? "无记录" : plan}</dd>
                </div>
                <div>
                    <dt>套餐到期</dt>
                    <dd>
                        {registered == null
                            ? "无记录"
                            : expiry == null
                              ? "未设置到期时间"
                              : date(expiry)}
                    </dd>
                </div>
            </dl>
            <a href={`#/users?user_id=${row[`${prefix}_id`]}`}>查看用户资料</a>
        </section>
    );
}
export function InvitationReviews() {
    const [filter, setFilter] = useState("pending");
    const [detail, setDetail] = useState<Row | null>(null);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState("");
    const [note, setNote] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const sequence = useRef(0);
    const saving = useRef(false);
    function prepare(row: Row) {
        setDetail(row);
        setState("");
        setNote("");
        setError("");
    }
    function close() {
        if (saving.current) return;
        sequence.current++;
        setDetail(null);
        setLoading(false);
        setReady(false);
    }
    async function open(row: Row) {
        const current = ++sequence.current;
        prepare(row);
        setReady(false);
        setLoading(true);
        try {
            const result = await readRequest<Row[]>(
                query(resource.fetch, { id: row.id, pageSize: 1 }),
                undefined,
                true,
            );
            if (current !== sequence.current) return;
            if (!result.data?.[0])
                throw new Error("记录已不存在，请刷新列表。");
            setDetail(result.data[0]);
            setReady(true);
        } catch (e) {
            if (current === sequence.current)
                setError(e instanceof Error ? e.message : "资料加载失败");
        } finally {
            if (current === sequence.current) setLoading(false);
        }
    }
    async function save(next: boolean) {
        if (
            !detail ||
            !ready ||
            saving.current ||
            !state ||
            note.trim().length < 5
        )
            return;
        saving.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        let saved = false;
        try {
            await request(admin("invitation-review/review"), {
                id: detail.id,
                revision: detail.revision,
                state,
                note: note.trim(),
            });
            saved = true;
            sequence.current++;
            setDetail(null);
            setReady(false);
            setRevision((v) => v + 1);
            if (next) {
                const result = await readRequest<Row[]>(
                    query(resource.fetch, {
                        state: "pending",
                        queue: 1,
                        pageSize: 1,
                    }),
                    undefined,
                    true,
                );
                if (result.data?.[0]) {
                    prepare(result.data[0]);
                    setReady(true);
                } else setNotice("结论已保存，当前没有待审核记录。");
            } else setNotice("审核结论已保存，不会自动封禁账号或扣除佣金。");
        } catch (e) {
            const message = e instanceof Error ? e.message : "操作失败";
            if (saved) setNotice(`结论已保存，但下一条加载失败：${message}`);
            else setError(message);
        } finally {
            saving.current = false;
            setBusy(false);
        }
    }
    const disabled =
        busy ||
        loading ||
        !ready ||
        !state ||
        note.trim().length < 5 ||
        note.trim().length > 1000;
    return (
        <>
            {notice && (
                <p className="invitation-notice" role="status">
                    {notice}
                </p>
            )}
            <ResourcePage
                key={`${filter}:${revision}`}
                resource={resource}
                queryParams={
                    filter === "pending"
                        ? { state: filter, queue: 1 }
                        : filter
                          ? { state: filter }
                          : {}
                }
                toolbar={
                    <div className="invitation-toolbar">
                        <p className="muted">
                            同 IP 仅提示核查；同 UA
                            不单独进入待审核。先核实再下结论，不自动封禁或扣佣金。
                        </p>
                        <label>
                            查看范围
                            <select
                                aria-label="复核状态"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                            >
                                <option value="">全部记录</option>
                                {Object.entries(labels).map(([k, v]) => (
                                    <option key={k} value={k}>
                                        {v}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                }
                extraActions={(r) => (
                    <button disabled={busy} onClick={() => void open(r)}>
                        查看并审核
                    </button>
                )}
            />
            {detail && (
                <Modal
                    title="邀请人工复核"
                    variant="drawer"
                    wide
                    className="invitation-review-drawer"
                    dismissible={!busy}
                    close={close}
                >
                    <form
                        className="invitation-review-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void save(false);
                        }}
                    >
                        <div className="invitation-summary">
                            <ShieldCheck aria-hidden="true" />
                            <div>
                                <strong>{trigger(detail)}</strong>
                                <p className="muted">
                                    当前状态：
                                    {labels[detail.state] || "未知状态"} · 记录
                                    #{detail.id}
                                </p>
                            </div>
                        </div>
                        {loading && <p role="status">正在加载最新资料…</p>}
                        <div className="invitation-people">
                            <Person row={detail} inviter />
                            <Person row={detail} inviter={false} />
                        </div>
                        <EvidenceComparison row={detail} />
                        <section className="invitation-evidence">
                            <h3>其他核查参考</h3>
                            <dl>
                                <div>
                                    <dt>邀请人近期邀请</dt>
                                    <dd>
                                        {detail.invitation_counts
                                            ? `24 小时 ${detail.invitation_counts.last24Hours} 人 · 7 天 ${detail.invitation_counts.last7Days} 人 · 累计 ${detail.invitation_counts.total} 人`
                                            : "无记录"}
                                        <small>
                                            截至当前的数量，仅作参考，不自动认定批量违规。
                                        </small>
                                    </dd>
                                </div>
                                <div>
                                    <dt>关联订单佣金</dt>
                                    <dd>
                                        {commissionText(detail)}
                                        <small>
                                            按订单币种分别汇总，不代表实际到账；未支付、已取消订单不计入。
                                        </small>
                                    </dd>
                                </div>
                            </dl>
                            <p className="muted">
                                缺失或已清理的历史资料不能补推。IP、UA
                                均相同也不能单独证明是同一人。
                            </p>
                            <a href="#/invitations?tab=commissions">
                                进入佣金审核
                            </a>
                        </section>
                        <fieldset
                            className="invitation-decisions"
                            disabled={busy || loading || !ready}
                        >
                            <legend>选择审核结论</legend>
                            <div role="group" aria-label="审核结论">
                                {conclusions.map(
                                    ({ value, label, help, Icon }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            aria-pressed={state === value}
                                            onClick={() => {
                                                if (state !== value) {
                                                    setState(value);
                                                    setNote("");
                                                }
                                            }}
                                        >
                                            <Icon aria-hidden="true" />
                                            <strong>{label}</strong>
                                            <small>{help}</small>
                                        </button>
                                    ),
                                )}
                            </div>
                            {!!availableReasons(state, detail).length && (
                                <div
                                    className="invitation-reasons"
                                    aria-label="常用审核理由"
                                >
                                    {availableReasons(state, detail).map(
                                        (text) => (
                                            <button
                                                key={text}
                                                type="button"
                                                onClick={() => setNote(text)}
                                            >
                                                {text}
                                            </button>
                                        ),
                                    )}
                                </div>
                            )}
                            <label>
                                复核依据
                                <textarea
                                    required
                                    minLength={5}
                                    maxLength={1000}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder={
                                        state === "confirmed"
                                            ? "请写明已核实的具体依据及违反的邀请规则；仅同 IP、UA 不足以认定违规。"
                                            : "选择常用理由，或填写至少 5 个字的核验说明。不要填写密码、令牌等敏感信息。"
                                    }
                                />
                            </label>
                            <p className="muted">
                                结论只留档。封禁、佣金处理需在对应管理页面另行操作。
                            </p>
                        </fieldset>
                        {error && (
                            <div role="alert">
                                <p>{error}</p>
                                {!ready && !loading && (
                                    <button
                                        type="button"
                                        onClick={() => void open(detail)}
                                    >
                                        重新加载资料
                                    </button>
                                )}
                                {ready && !busy && (
                                    <button
                                        type="button"
                                        onClick={() => void open(detail)}
                                    >
                                        重新加载最新记录
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="invitation-review-footer">
                            <button disabled={disabled}>
                                {busy ? "正在保存…" : "保存结论"}
                            </button>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => void save(true)}
                            >
                                保存并审核下一条
                            </button>
                        </div>
                        <section className="invitation-history">
                            <h3>审核历史</h3>
                            {detail.history?.length ? (
                                detail.history.map((h: Row) => (
                                    <article key={h.id}>
                                        <strong>
                                            {labels[h.state] || h.state}
                                        </strong>
                                        <small>
                                            {date(h.created_at)} · 管理员 #
                                            {h.admin_id}
                                        </small>
                                        <p>{h.note}</p>
                                    </article>
                                ))
                            ) : (
                                <p className="muted">暂无人工审核记录。</p>
                            )}
                        </section>
                    </form>
                </Modal>
            )}
        </>
    );
}
