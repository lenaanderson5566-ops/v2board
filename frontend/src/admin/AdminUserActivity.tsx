import { RiskEvidence } from "./RiskEvidence";
import { IpLocation } from "../shared/IpLocation";
import { AdminStatus } from "../shared/admin-status";
import { useState } from "react";
import { ops, date, bytes, rows, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { adminUserLabel } from "./admin-user-label";
export function AdminUserActivityLink({ row }: { row: Row }) {
 const [open, setOpen] = useState(false);
 return <>{row.user_id ? <button className="link" onClick={() => setOpen(true)}>{adminUserLabel(row)}</button> : adminUserLabel(row)}
 {open && <Activity row={row} close={() => setOpen(false)} />}</>;
}
const activityKinds = ["全部", "订阅", "连接", "风控", "登录"];
const activityTones: Record<string, string> = { "订阅": "subscription", "连接": "connection", "风控": "risk", "登录": "login" };
const formatBytes = (value: unknown) => value == null ? "—" : bytes(Number(value));

function Activity({ row, close }: { row: Row; close: () => void }) {
    const [kind, setKind] = useState("全部");
    const d = useData(ops(`risk/user-activity/fetch?user_id=${encodeURIComponent(row.user_id)}`));
    const events = rows(d.data?.events);
    const visible = events.filter(event => kind === "全部" || event.kind === kind);
    const user = d.data?.user;
    return <Modal title="用户活动详情" variant="drawer" wide className="user-activity-drawer" close={close}>
        <div className="user-activity">
            <header className="user-activity-identity">
                <div><span className="user-activity-eyebrow">账户 · ID {row.user_id}</span><h3>{user?.email || row.email || "邮箱不可用"}</h3></div>
                <button onClick={d.reload} disabled={d.loading}>刷新记录</button>
            </header>
            <State {...d} retry={d.reload}>
                {user && <section className="user-activity-summary" aria-label="账户概况">
                    <dl>
                        <div><dt>账户状态</dt><dd>{Number(user.banned) === 1 ? "已封禁" : "正常"}</dd></div>
                        <div><dt>到期时间</dt><dd>{user.expired_at == null ? "无到期限制" : date(user.expired_at)}</dd></div>
                        <div><dt>流量包剩余</dt><dd>{formatBytes(user.credit_balance)}</dd></div>
                        <div><dt>累计上传 / 下载</dt><dd>{formatBytes(user.u)} / {formatBytes(user.d)}</dd></div>
                    </dl>
                </section>}
                {d.data && !user && <p className="user-activity-notice">用户已不存在，以下为保留的历史记录。</p>}
                <nav className="user-activity-filters" aria-label="活动类型">
                    {activityKinds.map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>
                        {value}{" "}<span>{value === "全部" ? events.length : events.filter(event => event.kind === value).length}</span>
                    </button>)}
                </nav>
                <p className="user-activity-caption">每类最近 50 条，按时间倒序 · 连接记录不代表当前在线</p>
                {!visible.length && <div className="user-activity-empty" role="status">{kind === "全部" ? "暂无活动记录" : `暂无${kind}记录`}</div>}
                <div className="user-activity-list">
                    {visible.map(event => <article key={`${event.kind}-${event.id}`} className={`user-activity-event activity-${activityTones[event.kind] || "other"}`} aria-label={`${event.kind}记录`}>
                        <header className="user-activity-event-head">
                            <span className="user-activity-kind">{event.kind}</span>
                            <time>{date(event.at)}</time>
                            <span className="user-activity-result">{event.kind === "登录" ? <AdminStatus value={event.is_success} login /> : event.status != null ? <AdminStatus value={event.status} /> : null}</span>
                        </header>
                        <dl className="user-activity-fields">
                            <div><dt>IP / 地区</dt><dd><IpLocation row={event} /></dd></div>
                            {event.client_type && <div><dt>客户端</dt><dd>{event.client_type}</dd></div>}
                            {event.node && <div><dt>连接节点</dt><dd>{event.node}</dd></div>}
                            {event.rule_key && <div><dt>命中规则</dt><dd>{event.rule_name || "历史规则"}{event.risk_level && <span className="user-activity-risk-level">{event.risk_level}</span>}</dd></div>}
                            {event.kind === "订阅" && <div><dt>流量快照 · 上传 / 下载</dt><dd>{formatBytes(event.traffic_u)} / {formatBytes(event.traffic_d)}</dd></div>}
                            {event.reason && <div className="user-activity-full"><dt>说明</dt><dd>{event.reason}</dd></div>}
                        </dl>
                        {event.user_agent && <details className="user-activity-details"><summary>客户端标识（UA）</summary><p>{event.user_agent}</p></details>}
                        {event.kind === "风控" && <details className="user-activity-details"><summary>查看风控证据</summary><RiskEvidence payload={event.payload || {}} /></details>}
                    </article>)}
                </div>
            </State>
        </div>
    </Modal>;
}
