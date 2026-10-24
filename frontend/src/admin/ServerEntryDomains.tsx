import { useEffect, useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Table } from "../shared/ui";
import { domainStatus } from "./NodeDomains";

export function ServerEntryFields({value,roots,family,onChange,disabled=false}:{value:Row;roots:Row[];family:string;onChange:(value:Row)=>void;disabled?:boolean}) {
    return <>
        <label>入口根域名<select required disabled={disabled} value={value.entry_credential_id || ""} onChange={e=>onChange({...value,entry_credential_id:e.target.value})}><option value="">选择已验证的根域名</option>{roots.map(r=><option key={r.id} value={r.id}>{r.root_domain}</option>)}</select></label>
        <label>入口子域名前缀<input required disabled={disabled} maxLength={63} pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" value={value.entry_prefix || ""} onChange={e=>onChange({...value,entry_prefix:e.target.value.toLowerCase()})}/></label>
        <label>入口地址类型<select disabled={disabled} value={value.entry_family || family} onChange={e=>onChange({...value,entry_family:e.target.value})}>{(family==="dual"?["ipv4","ipv6","dual"]:[family]).map(f=><option key={f} value={f}>{{ipv4:"IPv4",ipv6:"IPv6",dual:"双栈"}[f]}</option>)}</select></label>
        {!roots.length && <p>请先在 <a href="#/node-domains">域名与解析</a> 中添加并验证根域名。</p>}
        <p className="muted">域名将关联当前服务器的 IP 上报，保存后等待解析同步。入口转发仍需配置并验证。</p>
    </>;
}
export const entryPayload=(value:Row)=>({credential_id:Number(value.entry_credential_id),prefix:value.entry_prefix,family:value.entry_family});

export function ServerEntryDomains({server,data,reload,onBusy,onDirty}:{server:Row;data:Row;reload:()=>void;onBusy?:(busy:boolean)=>void;onDirty?:(dirty:boolean)=>void}) {
    const roots:Row[]=(data.credentials || []).filter((r:Row)=>r.root_domain);
    const entries:Row[]=(data.assignments || []).filter((a:Row)=>a.purpose==="entry" && Number(a.server_id)===Number(server.id));
    const references=(entry:Row)=>Number(entry.connection_count ?? (data.assignments || []).filter((a:Row)=>Number(a.entry_id)===Number(entry.id)).length);
    const [draft,setDraft]=useState<Row | null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[adoption,setAdoption]=useState<Row | null>(null);
    const pending=useRef(false);
    useEffect(()=>onBusy?.(busy),[busy,onBusy]);useEffect(()=>onDirty?.(!!draft),[draft,onDirty]);
    function edit(entry?:Row){
        if(draft && !confirm("入口域名尚未保存，确认放弃修改？"))return;
        const root=roots.find(r=>Number(r.id)===Number(entry?.credential_id));
        setDraft({id:entry?.id,entry_credential_id:root?.id || "",entry_prefix:entry && root && entry.domain.endsWith("."+root.root_domain)?entry.domain.slice(0,-root.root_domain.length-1):"",entry_family:entry?.family || server.family});setError("");setNotice("");
    }
    async function act(action:string,body:Row,domain=false){
        if(pending.current)return;pending.current=true;setBusy(true);setError("");setNotice("");
        try{
            const r=await request<Row>(admin(`server/${domain?"domains":"network"}/${action}`),body);
            if(action==="adopt")setAdoption(r.data?.rows?{...r.data,id:body.id}:null);
            if(action==="entry")setDraft(null);
            reload();setNotice(action==="retry"?"已安排解析同步，将使用此服务器最近上报的 IP。":action==="entry"?"入口域名已保存，等待 IP 上报与解析同步。":action==="entry-drop"?"入口域名已移除，托管解析进入清理流程。":"操作已完成。");
        }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
    }
    return <section className="server-entry-domains" data-saving={busy || undefined} data-unsaved={!!draft || undefined}>
        <p className="muted">新建和已有服务器均可添加多个入口域名，供不同线路共享。入口只负责域名与解析，转发关系在节点接入中配置。</p>
        <div className="actions"><h3>入口域名</h3><button type="button" disabled={busy || !server.enabled} onClick={()=>edit()}>添加入口域名</button></div>
        {!server.enabled && <p className="muted">启用服务器后可添加入口域名。</p>}
        <Table data={entries} columns={[["domain","入口域名"],["family","地址类型",r=>({ipv4:"IPv4",ipv6:"IPv6",dual:"双栈"})[r.family as string] || r.family],["status","解析状态",r=>domainStatus[r.status] || r.status],["connection_count","关联线路",r=>references(r)]]} actions={r=><div className="actions"><button disabled={busy || !server.enabled || references(r)>0} title={references(r)>0?"入口正在使用，请新增入口后逐条切换线路":undefined} onClick={()=>edit(r)}>编辑入口</button><button disabled={busy} onClick={()=>act("retry",{id:r.id},true)}>重试解析同步</button>{r.status==="ownership_conflict" && <button disabled={busy} onClick={()=>act("adopt",{id:r.id},true)}>预览现有解析</button>}<button disabled={busy || references(r)>0} title={references(r)>0?"请先解除关联线路":undefined} onClick={()=>{if(confirm(`删除入口域名「${r.domain}」？存在关联线路时将禁止删除。`))act("entry-drop",{id:r.id});}}>删除入口</button></div>}/>
        {draft && <form className="node-domain-form" onSubmit={e=>{e.preventDefault();act("entry",{id:draft.id,server_id:Number(server.id),...entryPayload(draft)});}}><ServerEntryFields value={draft} roots={roots} family={server.family} disabled={busy} onChange={setDraft}/><button className="primary" disabled={busy || !roots.length}>保存入口域名</button><button type="button" disabled={busy} onClick={()=>{if(confirm("放弃尚未保存的入口配置？"))setDraft(null);}}>取消入口编辑</button></form>}
        {adoption && <div className="admin-deployment-card"><h4>接管入口解析</h4><Table data={adoption.rows} columns={[["name","域名"],["type","类型"],["content","当前 IP"]]}/><p>确认记录属于当前服务器后接管。</p><button disabled={busy || !adoption.rows?.length} onClick={()=>act("adopt",{id:adoption.id,proof:adoption.proof},true)}>确认接管</button><button disabled={busy} onClick={()=>setAdoption(null)}>取消接管</button></div>}
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>;
}
