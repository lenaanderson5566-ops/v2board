import { useState } from "react";
import { admin, date, request, type Row } from "../shared/api";
import { ResourcePage } from "./admin";
import { Modal } from "../shared/ui";

const labels: Record<string, string> = {
    pending: "待人工复核",
    confirmed: "确认违规",
    false_positive: "排除疑似",
    insufficient: "证据不足",
    no_signal: "未发现同源信号",
};
const signal = (value: unknown) =>
    value == null ? "无记录" : value ? "相同" : "不同";
const resource = {
    title: "邀请异常复核",
    fetch: admin("invitation-review/fetch"),
    fields: [],
    create: false,
    serverSearch: true,
    columns: [
        ["email", "受邀用户"],
        ["inviter_email", "邀请人"],
        [
            "signals",
            "注册信号",
            (r: Row) =>
                `IP：${signal(r.signals.sameRegistrationIp)} · UA：${signal(r.signals.sameRegistrationUa)}`,
        ],
        ["state", "复核结果", (r: Row) => labels[r.state]],
        ["created_at", "记录时间", (r: Row) => date(r.created_at)],
    ] as Parameters<typeof ResourcePage>[0]["resource"]["columns"],
};
export function InvitationReviews() {
    const [filter, setFilter] = useState("pending"),
        [detail, setDetail] = useState<Row | null>(null),
        [revision, setRevision] = useState(0);
    const [state, setState] = useState("insufficient"),
        [note, setNote] = useState(""),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false);
    return (
        <>
            <ResourcePage
                key={`${filter}:${revision}`}
                resource={resource}
                queryParams={filter ? { state: filter } : {}}
                toolbar={
                    <div className="pad">
                        <p className="muted">
                            相同 IP 可能来自共享网络，相同 UA
                            仅为弱信号；均不自动封禁或扣除佣金。仅记录更新后的注册证据，旧账号及超出保留期的证据不会推测补齐。复核结论只留档，处罚需在用户或佣金管理中另行操作。
                        </p>
                        <select
                            aria-label="复核状态"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                        >
                            <option value="">全部</option>
                            {Object.entries(labels).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </div>
                }
                extraActions={(r) => (
                    <button
                        onClick={() => {
                            setDetail(r);
                            setNote("");
                            setError("");
                            setState("insufficient");
                        }}
                    >
                        人工复核
                    </button>
                )}
            />
            {detail && (
                <Modal
                    title="邀请人工复核"
                    close={() => {
                        if (!busy) setDetail(null);
                    }}
                >
                    <form
                        onSubmit={async (e) => {
                            e.preventDefault();
                            if (busy) return;
                            setBusy(true);
                            setError("");
                            try {
                                await request(
                                    admin("invitation-review/review"),
                                    {
                                        id: detail.id,
                                        revision: detail.revision,
                                        state,
                                        note: note.trim(),
                                    },
                                );
                                setDetail(null);
                                setRevision((v) => v + 1);
                            } catch (e) {
                                setError(
                                    e instanceof Error ? e.message : "保存失败",
                                );
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        <p>
                            {detail.inviter_email} → {detail.email}
                        </p>
                        <p className="actions">
                            <a href={`#/users?user_id=${detail.user_id}`}>
                                受邀用户
                            </a>
                            <a href={`#/users?user_id=${detail.inviter_id}`}>
                                邀请人
                            </a>
                            <a href="#/invitations?tab=commissions">佣金审核</a>
                        </p>
                        <p>
                            注册 IP：{signal(detail.signals.sameRegistrationIp)}
                            ；注册 UA：
                            {signal(detail.signals.sameRegistrationUa)}
                        </p>
                        <label>
                            结论
                            <select
                                value={state}
                                onChange={(e) => setState(e.target.value)}
                            >
                                {[
                                    "insufficient",
                                    "false_positive",
                                    "confirmed",
                                ].map((k) => (
                                    <option key={k} value={k}>
                                        {labels[k]}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            复核依据
                            <textarea
                                required
                                minLength={5}
                                maxLength={1000}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="说明核验依据，不要填写密码、令牌等敏感信息"
                            />
                        </label>
                        {error && <p role="alert">{error}</p>}
                        <button disabled={busy || note.trim().length < 5}>
                            保存复核结论
                        </button>
                        <h3>复核历史</h3>
                        {detail.history.map((h: Row) => (
                            <p key={h.id}>
                                {date(h.created_at)} · 管理员 #{h.admin_id} ·{" "}
                                {labels[h.state]}：{h.note}
                            </p>
                        ))}
                    </form>
                </Modal>
            )}
        </>
    );
}
