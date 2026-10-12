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
function Activity({ row, close }: { row: Row; close: () => void }) {
 const [kind, setKind] = useState("全部");
 const d = useData(ops(`risk/user-activity/fetch?user_id=${encodeURIComponent(row.user_id)}`));
 return <Modal title="用户活动详情" variant="drawer" close={close}><div className="pad">
 <p>{adminUserLabel({user_id: row.user_id, email: d.data?.user?.email || row.email})}</p>
 <p className="muted">每类最近 50 条记录，按时间倒序；连接记录不代表当前在线。</p>
 <button onClick={d.reload}>刷新</button>
 {d.data?.user && <div className="risk-rule-card"><p>账户：{d.data.user.banned ? "已封禁" : "正常"} · 到期：{date(d.data.user.expired_at)}</p><p>剩余额度：{bytes(d.data.user.credit_balance ?? 0)} · 累计上传：{bytes(d.data.user.u ?? 0)} · 累计下载：{bytes(d.data.user.d ?? 0)}</p></div>}
 <div className="actions" aria-label="活动类型">{["全部", "订阅", "连接", "风控", "登录"].map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value}</button>)}</div>
 <State {...d} retry={d.reload}>
 {d.data && !d.data.user && <p className="muted">用户已不存在，以下为保留的历史记录。</p>}
 {!rows(d.data?.events).length && <p className="muted">暂无活动记录</p>}
 {rows(d.data?.events).filter(r => kind === "全部" || r.kind === kind).map(r => <article key={`${r.kind}-${r.id}`} className="risk-rule-card">
 <strong>{r.kind}</strong> <time>{date(r.at)}</time>
 <p><IpLocation row={r} /></p>
 {r.rule_key && <p>{r.rule_name || "历史规则"} · {r.risk_level}</p>}
 {r.node && <p>节点：{r.node}</p>}
 {r.client_type && <p>客户端：{r.client_type}</p>}
 {r.kind === "登录" && <p><AdminStatus value={r.is_success} login /></p>}
 {r.kind !== "登录" && r.status != null && <p>结果：<AdminStatus value={r.status} /></p>}
 {r.reason && <p>说明：{r.reason}</p>}
 {r.user_agent && <p style={{overflowWrap:"anywhere"}}>UA：{r.user_agent}</p>}
 {r.kind === "风控" && <RiskEvidence payload={r.payload} />}
 {r.kind === "订阅" && <p className="muted">流量快照：{r.traffic_u == null || r.traffic_d == null ? "数据缺失" : bytes(Number(r.traffic_u) + Number(r.traffic_d))}</p>}
 </article>)}
 </State></div></Modal>;
}
