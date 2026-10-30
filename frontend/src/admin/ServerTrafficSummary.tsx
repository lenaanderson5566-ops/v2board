import { admin, bytes, type Row } from "../shared/api";
import { State, Table, useData } from "../shared/ui";
import { adminInstant, logTime } from "./admin-log-time";
import { ProtocolBadge } from "./ProtocolBadge";
export function quotaState(budget?: Row) {
    if(!budget)return "未设置";
    if(budget.blocked)return "已达额度";
    if(Number(budget.limitBytes)>0 && Number(budget.usedBytes)>=Number(budget.limitBytes)*0.9)return "接近额度";
    return Number(budget.limitBytes)>0 ? "正常" : "不限量";
}
export function ServerTrafficSummary({server,onNavigate}:{server:Row;onNavigate?:()=>boolean}) {
    const d=useData<Row>(admin(`server/network/traffic?id=${server.id}`));
    const b=d.data?.budget;
    return <section className="server-traffic-details" aria-label="服务器用量与关联节点">

        <State {...d} retry={d.reload}>
            <h3>流量与计费周期</h3>
            {b ? <p>{quotaState(b)} · {bytes(b.usedBytes || 0)} / {Number(b.limitBytes)>0 ? bytes(b.limitBytes) : "不限量"}</p> : <p>尚未配置流量额度，可在上方流量额度中设置。</p>}
            {b && <><p>当前周期：{adminInstant(b.periodStart)} 至 {adminInstant(b.periodEnd)}（结束时间不包含在本周期内）</p><p>计费方向：{{both:"上传 + 下载",upload:"仅上传",download:"仅下载"}[b.countingMode as string]}</p><p>本月双向流量：{bytes(Number(b.thisMonth?.uploadBytes || 0)+Number(b.thisMonth?.downloadBytes || 0))} · 近 30 天：{bytes(Number(b.last30Days?.uploadBytes || 0)+Number(b.last30Days?.downloadBytes || 0))}</p></>}
            <h3>关联代理服务</h3><Table data={d.data?.nodes || []} columns={[["name","代理服务"],["protocol","协议",n=><ProtocolBadge protocol={n.protocol}/>],["listenPort","监听端口"],["type","后端"],["id","服务 ID"]]} actions={n=><a onClick={e=>{if(onNavigate && !onNavigate())e.preventDefault();}} href={`#/nodes?service=${encodeURIComponent(`${n.type}:${n.id}`)}`}>管理节点</a>}/>
            <h3>每日用量（最近 90 天）</h3><Table data={d.data?.history || []} columns={[["dayAt","日期",r=>logTime(r.dayAt)],["uploadBytes","上传",r=>bytes(r.uploadBytes)],["downloadBytes","下载",r=>bytes(r.downloadBytes)]]}/>
            <p className="muted">首次关联自动纳入近期节点统计；后续修改额度保留历史记录。每日用量不应用节点倍率，入口转发流量未接入节点统计时不会重复计入。</p>
        </State></section>;
}

export function ServerStatus({server}:{server:Row}) {return <dl><dt>状态</dt><dd>{server.enabled?"已启用":"已停用"}</dd><dt>地址类型</dt><dd>{{ipv4:"IPv4",ipv6:"IPv6",dual:"双栈"}[server.family as string] || server.family}</dd><dt>IPv4</dt><dd>{server.ipv4 || "—"}</dd><dt>IPv6</dt><dd>{server.ipv6 || "—"}</dd><dt>最近上报</dt><dd>{Math.max(Number(server.ipv4_seen_at)||0,Number(server.ipv6_seen_at)||0)?logTime(Math.max(Number(server.ipv4_seen_at)||0,Number(server.ipv6_seen_at)||0)):"尚未上报"}</dd></dl>;}

export function serverReportStatus(server:Row, now=Date.now()/1000):string {
    if(!server.enabled)return "已停用";
    const families=server.family === "dual" ? ["ipv4","ipv6"] : [server.family || "ipv4"];
    const missing=families.filter(f=>!server[f] || !Number(server[`${f}_seen_at`]));
    if(missing.length)return `待上报 ${missing.map(f=>f==="ipv4"?"IPv4":"IPv6").join("、")}`;
    if(families.some(f=>Number(server[`${f}_seen_at`]) < now-900))return "上报已过期，请检查本机上报服务";
    return "IP 上报正常";
}
