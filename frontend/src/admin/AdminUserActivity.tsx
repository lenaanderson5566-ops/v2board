import { useState } from "react";
import { ops, date, rows, type Row } from "../shared/api";
import { Modal, State, useData } from "../shared/ui";
import { adminUserLabel } from "./admin-user-label";
export function AdminUserActivityLink({ row }: { row: Row }) {
 const [open, setOpen] = useState(false);
 return <>{row.user_id ? <button className="link" onClick={() => setOpen(true)}>{adminUserLabel(row)}</button> : adminUserLabel(row)}
 {open && <Activity row={row} close={() => setOpen(false)} />}</>;
}
function Activity({ row, close }: { row: Row; close: () => void }) {
 const d = useData(ops(`risk/user-activity/fetch?user_id=${encodeURIComponent(row.user_id)}`));
 return <Modal title="用户活动详情" variant="drawer" close={close}><div className="pad">
 <p>{adminUserLabel({user_id: row.user_id, email: d.data?.user?.email || row.email})}</p>
 <p className="muted">每类最近 50 条记录，按时间倒序；连接记录不代表当前在线。</p>
 <button onClick={d.reload}>刷新</button>
 <State {...d} retry={d.reload}>
 {d.data && !d.data.user && <p className="muted">用户已不存在，以下为保留的历史记录。</p>}
 {!rows(d.data?.events).length && <p className="muted">暂无活动记录</p>}
 {rows(d.data?.events).map(r => <article key={`${r.kind}-${r.id}`} className="risk-rule-card">
 <strong>{r.kind}</strong> <time>{date(r.at)}</time>
 <p>IP：{r.ip || "—"}</p>
 {r.rule_key && <p>{r.rule_key} · {r.risk_level}</p>}
 {r.node && <p>节点：{r.node}</p>}
 {r.client_type && <p>客户端：{r.client_type}</p>}
 {r.kind === "登录" && <p>{r.is_success ? "登录成功" : "登录失败"}</p>}
 {r.status && <p>结果：{r.status}</p>}
 </article>)}
 </State></div></Modal>;
}
