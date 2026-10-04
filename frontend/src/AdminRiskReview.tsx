import {useState} from "react";
import {ops,request,date,type Row} from "./api";
import {Modal} from "./ui";
const states:Record<string,string>={pending:"待处理",confirmed:"已确认",false_positive:"误报",ignored:"已忽略"};
const evidence:Record<string,string>={threshold:"命中阈值",window_seconds:"统计窗口（秒）",failed_count:"失败次数",distinct_ip_count:"不同 IP 数",request_count:"请求次数",subscribe_count:"成功订阅次数",subscribe_threshold:"订阅次数阈值",traffic_growth_bytes:"流量增长（字节）",traffic_growth_threshold_bytes:"流量增长上限（字节）",distinct_client_type_count:"客户端类型数",ip:"命中 IP",ua_hash:"命中 UA 哈希"};
export function AdminRiskReview({row}:{row:Row}){
 const [open,setOpen]=useState(false),[review,setReview]=useState(row.payload?.review || {}),[state,setState]=useState(row.payload?.review?.state || "pending"),[note,setNote]=useState(row.payload?.review?.note || ""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 return <><button onClick={()=>setOpen(true)}>{states[review.state] || "待处理"} · 证据</button>{open && <Modal title="命中证据与人工复核" close={()=>setOpen(false)}><div className="pad">
 <p>{row.email || "未识别账号"} · ID {row.user_id || "—"}</p><p>{row.rule_key} · {date(row.hit_at)}</p>
 <p className="muted">复核仅针对这组中最新一条原始记录（#{row.id}），不封禁用户、不修改其他命中。IP 或客户端类型数量不等于设备数量。</p>
 <dl>{Object.entries(row.payload || {}).filter(([k])=>evidence[k]).map(([k,v])=><div key={k}><dt>{evidence[k]}</dt><dd style={{overflowWrap:"anywhere"}}>{String(v)}</dd></div>)}</dl>
 {!Object.keys(row.payload || {}).some(k=>evidence[k]) && <p>此历史记录没有可展示的命中数值。</p>}
 {row.payload?.review_history?.length>0 && <details><summary>复核历史</summary>{row.payload.review_history.map((entry:Row,index:number)=><p key={index}>{date(entry.at)} · 管理员 #{entry.admin_id ?? "—"} · {states[entry.state] || entry.state}：{entry.note || "无备注"}</p>)}</details>}
 <label>复核状态<select value={state} onChange={e=>setState(e.target.value)}>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>备注<textarea maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
 {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await request(ops("log/rule-hit/review"),{id:row.id,state,note});setReview({state,note});setOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>保存复核</button>
 </div></Modal>}</>;
}
