import { AdminFilterBar } from "./AdminFilterBar";
import { TableViewport } from "../shared/ui";
import { Pager, FilterActions } from "../shared/ui";
import { useState } from "react";
import { admin, date, type Row } from "../shared/api";
import { Panel, Reload, State, useData } from "../shared/ui";
const statuses: Record<string, string> = {
    queued: "排队中",
    sending: "发送中",
    accepted: "服务商已接受",
    failed: "发送失败",
    uncertain: "结果不确定",
    skipped: "已跳过，未发送",
    legacy: "历史已发送，送达未知",
};
const deliveries: Record<string, string> = {
    delivered: "已送达收件服务器",
    temporary: "暂时延迟",
    rejected: "投递被拒绝",
    bounced: "永久退信",
    complained: "用户投诉",
    unsubscribed: "已退订",
};
const states: Record<string, string> = {
    accepted: "已注册",
    pending: "待注册",
    expired: "已过期",
};
export function InvitationEmails() {
    const [pageSize, setPageSize] = useState(20);
    const [draft, setDraft] = useState({
        inviter: "",
        recipient: "",
        state: "",
    });
    const [filters, setFilters] = useState(draft),
        [page, setPage] = useState(1);
    const query = new URLSearchParams({
        current: String(page),
        page_size: String(pageSize),
    });
    Object.entries(filters).forEach(([key, value]) => {
        if (value.trim()) query.set(key, value.trim());
    });
    const rows = useData<Row[]>(admin(`invitation-emails/fetch?${query}`));
    return (
        <Panel
            title="邀请邮件"
            actions={<Reload onClick={rows.reload} loading={rows.loading} />}
        >
            <p className="pad muted">展示每次邀请的最近发送结果。重发会使旧链接失效；服务商接受不代表送达，送达不代表阅读。邮件状态不自动决定奖励或复核结果。</p>
            <AdminFilterBar
                className="admin-log-filters"
                onSubmit={(e) => {
                    e.preventDefault();
                    setFilters({ ...draft });
                    setPage(1);
                }}
            >
                <label>
                    邀请人邮箱（精确）
                    <input
                        type="email"
                        value={draft.inviter}
                        onChange={(e) =>
                            setDraft({ ...draft, inviter: e.target.value })
                        }
                    />
                </label>
                <label>
                    收件邮箱（精确）
                    <input
                        type="email"
                        value={draft.recipient}
                        onChange={(e) =>
                            setDraft({ ...draft, recipient: e.target.value })
                        }
                    />
                </label>
                <label>
                    注册状态
                    <select
                        value={draft.state}
                        onChange={(e) =>
                            setDraft({ ...draft, state: e.target.value })
                        }
                    >
                        <option value="">全部</option>
                        {Object.entries(states).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <FilterActions
                    loading={rows.loading}
                    onReset={() => {
                        const empty = { inviter: "", recipient: "", state: "" };
                        setDraft(empty);
                        setFilters(empty);
                        setPage(1);
                    }}
                />
            </AdminFilterBar>
            <State {...rows} retry={rows.reload}>
                <TableViewport>
                    <table>
                        <thead>
                            <tr>
                                {[
                                    "邀请人",
                                    "收件邮箱",
                                    "最近请求 / 有效期",
                                    "发送 / 投递状态",
                                    "注册情况",
                                    "关联操作",
                                ].map((x) => (
                                    <th key={x}>{x}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(rows.data || []).map((r) => (
                                <tr key={r.id}>
                                    <td>
                                        <a
                                            href={`#/users?user_id=${r.user_id}`}
                                        >
                                            #{r.user_id}
                                        </a>
                                        <br />
                                        {r.inviter_email || "账号已删除"}
                                    </td>
                                    <td>{r.email}</td>
                                    <td>
                                        {date(r.requested_at)}
                                        <br />
                                        <span className="muted">
                                            有效至 {date(r.expires_at)}
                                        </span>
                                    </td>
                                    <td>
                                        {statuses[r.status] || "未知"}
                                        <br />
                                        {deliveries[r.delivery_status] ||
                                            "暂无投递反馈"}
                                        {r.error_code && (
                                            <p className="muted">
                                                {r.error_code}
                                            </p>
                                        )}
                                    </td>
                                    <td>
                                        {states[r.state]}
                                        {r.accepted_at && (
                                            <>
                                                <br />
                                                {date(r.accepted_at)}
                                            </>
                                        )}
                                    </td>
                                    <td>
                                        {r.accepted_user_id ? (
                                            <>
                                                <a
                                                    href={`#/users?user_id=${r.accepted_user_id}`}
                                                >
                                                    受邀用户 #
                                                    {r.accepted_user_id}
                                                </a>
                                                <br />
                                                <a href="#/invitations?tab=reviews">
                                                    异常复核
                                                </a>
                                                <br />
                                                <a href="#/invitations?tab=commissions">
                                                    佣金审核
                                                </a>
                                            </>
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!rows.data?.length && (
                        <p className="pad">暂无匹配邀请邮件</p>
                    )}
                </TableViewport>
            </State>
            <Pager
                size={pageSize}
                onSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                }}
                page={page}
                total={rows.total}
                loading={rows.loading}
                onChange={setPage}
            />
        </Panel>
    );
}
