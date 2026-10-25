import { type ReactNode, useMemo, useEffect, useRef, useState } from "react";
import { admin, query, request, type Row } from "../shared/api";
import { Modal, Panel, Table, State, useData } from "../shared/ui";
import { AdminSwitch } from "./admin-switch";
import { automaticDomainMessages } from "./node-domain-progress";
import { NodeTopology } from "./NodeTopology";
import { relayStreamConfig } from "./node-relay";
import { useNodeCatalog } from "./node-dictionary";

export function NodeConnectionEditor({ node, nodes, groups = [], close, onSaved, onPublished, embedded=false, onDirty, onBusyChange, onCreated, navigation, pauseRefresh=false, view="all" }: { pauseRefresh?:boolean; view?:"all"|"line"|"path"; navigation?:(busy:boolean,dirty:boolean)=>ReactNode; node: Row; nodes: Row[]; groups?: Row[]; close: () => void; onSaved: () => void; onPublished?:()=>void; embedded?:boolean; onDirty?:(dirty:boolean)=>void; onBusyChange?:(busy:boolean)=>void; onCreated?:(node:Row)=>void }) {
    const [id, setId] = useState<number | undefined>(node.id);
    const [type, setType] = useState<string>(node.type || "v2box");
    const catalog = useNodeCatalog();
    const existing = useData<Row>(id ? query(admin("server/connections/fetch"), { type, id }) : "", undefined, false, { refreshOnEvents: false });
    const network = useData<Row>(admin("server/ddns/fetch"), undefined, false, { refreshOnEvents: false });
    const services = nodes.filter(n => !n.service_id && n.type === type);
    const [draft, setDraft] = useState<Row>({ name: "", service_id: node.service_id || "", entry_id: "", entry_port: 443, group_id: [], show: 1 });
    const [tagsText, setTagsText] = useState("");
    const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
    const [dirty, setDirty] = useState(!id && !embedded), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
    const pending = useRef(false);
    const regionTouched=useRef(false);
    useEffect(()=>onDirty?.(dirty),[dirty,onDirty]);
    useEffect(()=>onBusyChange?.(busy),[busy,onBusyChange]);
    useEffect(() => {
        if (!dirty || embedded) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty,embedded]);
    useEffect(() => { if (existing.data && !dirty && !busy && loadedRevision !== (existing.data.revision ?? 0)) { setDraft(existing.data.draft); setLoadedRevision(existing.data.revision ?? 0); setTagsText((existing.data.draft.tags || []).join(", ")); setDirty(false); setConfirmed(false); } }, [existing.data,busy,dirty,loadedRevision]);
    const selectableServices=embedded && !id ? nodes.filter(n=>!n.service_id) : services;
    const service = services.find(s => Number(s.id) === Number(draft.service_id));
    const assignments: Row[] = network.data?.assignments || [], servers: Row[] = network.data?.servers || [];
    const origin = assignments.find(a => a.node_type === type && a.node_id === Number(draft.service_id));
    const reusable=useMemo(()=>{
        const physical=new Map((network.data?.servers || []).map((s:Row)=>[String(s.id),s]));
        return new Set((network.data?.assignments || []).filter((a:Row)=>a.purpose!=="entry" && a.status!=="manual" && a.enabled!==false && a.enabled!==0 && a.managed!==false && a.managed!==0 && a.server_id!==null && (physical.get(String(a.server_id)) as Row | undefined)?.enabled!==false && (physical.get(String(a.server_id)) as Row | undefined)?.enabled!==0).map((a:Row)=>`${a.node_type}:${a.node_id}`));
    },[network.data]);
    const canReuse=(s:Row | undefined)=>!!s && reusable.has(`${s.type}:${s.id}`);
    const entries = assignments.filter(a => a.purpose === "entry" && a.enabled);
    const entry = entries.find(a => a.id === Number(draft.entry_id));
    const validEntry=!draft.entry_id || (!!entry && Number.isInteger(Number(draft.entry_port)) && Number(draft.entry_port)>=1 && Number(draft.entry_port)<=65535);
    const publishedSignature=useRef<string | null>(null);
    useEffect(()=>{
        const value=existing.data;
        if(!value?.published)return;
        const published=value.published;
        const identity=JSON.stringify([published.service_id,value.current?.host,value.current?.port,published.proof]);
        const changed=publishedSignature.current!==null ? publishedSignature.current!==identity : Number(published.service_id)!==Number(node.service_id) || (value.current?.host && value.current.host!==node.host) || (value.current?.port && Number(value.current.port)!==Number(node.port));
        publishedSignature.current=identity;
        if(changed)onPublished?.();
    },[existing.data,node.service_id,node.host,node.port,onPublished]);
    const savedPlan = existing.data?.plan;
    const manualPublish = !!savedPlan?.entry_id || type!=="v2box" || ["hysteria","hysteria2","tuic"].includes(savedPlan?.protocol) || ["manual_required","configuration_blocked"].includes(existing.data?.automatic_status);
    useEffect(()=>{
        if (!id || dirty || busy || pauseRefresh || existing.loading) return;
        const timer=window.setInterval(()=>{if(document.visibilityState!=="hidden") existing.reload();},existing.error ? 60000 : 15000);
        return ()=>window.clearInterval(timer);
    },[id,dirty,busy,pauseRefresh,existing.loading,existing.error,existing.reload]);
    const config = savedPlan?.entry_id ? relayStreamConfig({ id: existing.data?.id, scope: "connection", domain: savedPlan.origin_domain, family: savedPlan.origin_family, entry_port: savedPlan.port }, { ...service, server_port: savedPlan.origin_port, protocol: savedPlan.protocol }, { family: savedPlan.entry_family }) : "";
    function change(key: string, value: unknown) {
        if(key==="region_code")regionTouched.current=true;
        setDraft(previous => ({...previous,[key]:value})); setDirty(true); setConfirmed(false); setNotice("");
    }
    function selectService(selected:Row | undefined) {
        if(selected)setType(selected.type);
        setDraft(previous=>({...previous,service_id:selected?.id || "",group_id:selected?.group_id || [],...(!id && !regionTouched.current && !previous.region_code ? {region_code:selected?.region_code || null,city_code:selected?.city_code || null} : {})}));
        setDirty(true);setConfirmed(false);setNotice("");
    }
    function dismiss() { if (!busy && (!dirty || window.confirm("线路配置尚未保存，确认放弃修改？"))) close(); }
    async function act(publish = false) {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError(""); setNotice("");
        try {
            if(!publish && (!canReuse(service) || !draft.name.trim() || !validEntry))throw new Error("请检查代理服务、节点名称及入口端口配置");
            const body = publish ? { type, id, revision: existing.data?.revision, proof: savedPlan?.proof, confirmed } : { ...draft, type, id, revision: existing.data?.revision || 0, service_id: Number(draft.service_id), entry_id: draft.entry_id ? Number(draft.entry_id) : null, entry_port: draft.entry_id ? Number(draft.entry_port) : null };
            const result = await request<Row>(admin(`server/connections/${publish ? "publish" : "save"}`), body);
            if (!publish && !id) {setId(result.data.id);onCreated?.({id:result.data.id,type,service_id:Number(draft.service_id),name:draft.name});} else existing.reload();
            setDirty(false); setConfirmed(false); onSaved();
            setNotice(publish ? "线路已发布，订阅将使用新的连接地址。" : "配置已保存。可自动验证的连接将自动发布；中转转发需确认后发布。");
        } catch (e) { setError((e as Error).message); }
        finally { pending.current = false; setBusy(false); }
    }
    const content=<>
        <State loading={network.loading || existing.loading || (!!id && !existing.error && (!existing.data || loadedRevision !== (existing.data.revision ?? 0)))} error={network.error || existing.error} retry={() => { network.reload(); existing.reload(); }}>
            <div className="admin-deployment-card" data-unsaved={dirty || undefined} data-saving={busy || undefined}>
                <div className="field-section">{view==="path" ? "接入路径" : "节点信息"}</div>
                <p className="muted">当前节点独立命名并设置地区、城市和标签。国家／地区表示代理服务的出口位置，中转入口位置单独显示。</p>
                <div className="node-domain-form">
                    {!id && !embedded && <label>服务内核<select value={type} disabled={busy} onChange={e => { setType(e.target.value); selectService(undefined); }}><option value="v2box">V2Box</option><option value="v2node">V2Node</option></select></label>}
                    {view!=="path" && <label>节点名称<input value={draft.name} disabled={busy} onChange={e => change("name", e.target.value)} /></label>}
                    {view!=="line" && <label>代理服务<select value={embedded && !id ? (draft.service_id ? `${type}:${draft.service_id}` : "") : draft.service_id || ""} disabled={busy} onChange={e => {
                        const selected=embedded && !id
                            ? selectableServices.find(s=>`${s.type}:${s.id}`===e.target.value)
                            : services.find(s=>Number(s.id)===Number(e.target.value));
                        selectService(selected);
                    }}><option value="">选择代理服务</option>{selectableServices.map(s => <option key={`${s.type}:${s.id}`} disabled={!canReuse(s)} value={embedded && !id ? `${s.type}:${s.id}` : s.id}>{s.name} · {s.protocol} · {s.type=== "v2box" ? "V2Box" : "V2Node"}{!canReuse(s)?"（需启用服务器和自动域名）":""}</option>)}</select></label>}
                    {service && !canReuse(service) && <p role="status">请先在关联代理服务的部署设置中启用服务器与自动域名管理，再保存或发布节点。</p>}
                    {!id && !selectableServices.length && <p role="status">暂无可共用服务的节点，请选择“独立部署新节点”。</p>}
                    {view!=="line" && <><label>连接方式<select value={draft.entry_id ? "relay" : "direct"} disabled={busy} onChange={e => change("entry_id", e.target.value === "relay" ? entries[0]?.id || "pending" : "")}><option value="direct">直连</option><option value="relay">入口中转</option></select></label>
                    {!!draft.entry_id && !entry && <p role="status">请先在 <a href="#/servers" onClick={event=>{if(busy || (dirty && !confirm("离开将放弃未保存的线路配置，确认前往服务器管理？")))event.preventDefault();}}>服务器管理</a> 中添加可用的入口域名。</p>}
                    {!!draft.entry_id && <><label>入口域名<select value={draft.entry_id} disabled={busy} onChange={e => change("entry_id", e.target.value)}><option value="pending">选择入口</option>{entries.map(e => <option key={e.id} value={e.id}>{e.domain} · {servers.find(s => s.id === e.server_id)?.name}</option>)}</select></label><label>入口端口<input type="number" min={1} max={65535} value={draft.entry_port || ""} disabled={busy} onChange={e => change("entry_port", e.target.value)} /></label></>}
                    </>}
                    {view!=="path" && <div><span>权限组</span><div className="option-group" role="group" aria-label="权限组">{(service?.group_id || []).map((g: number) => {
                        const selected = (draft.group_id || []).map(Number).includes(Number(g));
                        return <button type="button" role="checkbox" aria-checked={selected} disabled={busy} key={g} onClick={() => change("group_id", selected ? draft.group_id.filter((id: number) => Number(id) !== Number(g)) : [...draft.group_id, Number(g)])}><span className="option-check">{selected ? "✓" : ""}</span>{groups.find(group => Number(group.id) === Number(g))?.name || `权限组 #${g}`}</button>;
                    })}</div></div>}
                    {service && <p className="muted">计费倍率：{service.rate ?? 1}，随共享服务设置。协议、监听和证书在保存后通过“代理服务”维护。</p>}
                    {view!=="path" && <label>发布后展示<AdminSwitch label="发布后展示" checked={!!Number(draft.show)} disabled={busy} onChange={async value => change("show", Number(value))} /></label>}
                </div>
                {view!=="path" && <details open={view==="line"}><summary>节点展示信息</summary><div className="node-domain-form">
                    <label>国家 / 地区<select value={draft.region_code || ""} disabled={busy} onChange={e => { change("region_code", e.target.value || null); change("city_code", null); }}><option value="">使用节点名称</option>{Object.entries(catalog.regions).map(([code, names]) => <option key={code} value={code}>{names["zh-CN"] || names["en-US"]}</option>)}</select></label>
                    <label>州、省或城市<input value={draft.city_code || ""} list="connection-cities" disabled={busy} onChange={e => change("city_code", e.target.value || null)} /></label><datalist id="connection-cities">{Object.entries(catalog.cities).filter(([code]) => !draft.region_code || catalog.cityRegions[code] === draft.region_code).map(([code, names]) => <option key={code} value={code}>{names["zh-CN"] || names["en-US"]}</option>)}</datalist>
                    <label>线路编号 / 后缀<input value={draft.display_label || ""} disabled={busy} onChange={e => change("display_label", e.target.value || null)} /></label>
                    <label>标签（逗号分隔）<input value={tagsText} disabled={busy} onChange={e => { setTagsText(e.target.value); change("tags", e.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean)); }} /></label>
                </div></details>}
                <NodeTopology service={service} origin={origin} entry={draft.entry_id ? entry || {} : undefined} server={servers.find(s => s.id === origin?.server_id)} entryServer={servers.find(s => s.id === entry?.server_id)} port={draft.entry_id ? draft.entry_port : service?.server_port} preview={dirty || !id} shared={entry?.connection_count || 0} />
                <button className="primary" disabled={busy || !dirty || !canReuse(service) || !draft.name.trim() || !validEntry} onClick={() => act()}>保存待发布配置</button>
                {existing.data && <p>当前发布地址：{existing.data.published ? `${existing.data.current.host}:${existing.data.current.port}` : !existing.data.revision && node.host ? `${node.host}:${node.port}` : "尚未发布"}</p>}
                {view!=="line" && !dirty && savedPlan && <section className="admin-deployment-card">
                    <h3>生效状态</h3>
                    <p>{savedPlan.dns_ready ? "入口与回源解析已就绪。" : "等待服务器 IP 上报和解析同步。"}{savedPlan.transition_pending ? "代理服务证书正在切换，请等待完成。" : ""}</p>
                    {config && <details><summary>入口转发配置</summary><p>将此片段合并到入口服务器 Nginx 的 stream 配置，并替换该线路的旧片段。运行 nginx -t，通过后 reload。要求 Nginx 1.27.3 或更新版本。</p><pre className="admin-network-command">{config}</pre><button disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(config); setNotice("转发配置已复制。"); } catch { setError("复制失败，请手动复制配置。"); } }}>复制转发配置</button></details>}
                    <p>{automaticDomainMessages[existing.data?.automatic_status] || (manualPublish ? "请验证实际连接后确认发布。" : "系统将自动验证并发布，失败保留当前地址。")}</p>
                    {manualPublish && <><label className="node-quota-filter"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />已使用上述地址和代理服务身份完成客户端连接检查{config ? "，并确认入口转发配置已生效" : ""}</label>
                    <p className="muted">发布前再次检查服务配置回执。此确认记录为管理员验证，不代表系统已执行端到端探测。</p>
                    <button disabled={busy} onClick={() => { existing.reload(); network.reload(); }}>检查最新状态</button>{" "}<button className="primary" disabled={busy || !confirmed || !savedPlan.dns_ready || savedPlan.transition_pending} onClick={() => act(true)}>确认并发布线路</button></>}
                </section>}
                {existing.data?.error && <p className="alert">{existing.data.error}</p>}{error && <p className="alert" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
            </div>
        </State>
    </>;
    return embedded ? content : <Modal title={id ? `编辑节点 · ${node.name}` : "新增接入线路"} variant="drawer" className="node-editor-dialog" close={dismiss} wide>{navigation?.(busy,dirty)}{content}</Modal>;
}

export function NodeForwarding({ nodes, edit }: { nodes: Row[]; edit: (node: Row) => void }) {
    const data = useData<Row>(admin("server/ddns/fetch"));
    const connections: Row[] = data.data?.connections || [];
    const assignments: Row[] = data.data?.assignments || [];
    const records = connections.filter(c => c.entry_id || c.published?.entry_id).map(c => {
        const node = nodes.find(n => n.type === c.node_type && n.id === c.node_id);
        const draftEntry = assignments.find(a => a.id === c.entry_id);
        return { ...c, id: `connection-${c.id}`, name: node?.name || `#${c.node_id}`, entry: draftEntry ? `${draftEntry.domain}:${c.entry_port}` : "直连（待发布）", active: c.published ? `${c.published.host}:${c.published.port} → ${c.published.origin_domain}:${c.published.origin_port}` : "尚未发布", node };
    });
    for (const binding of assignments.filter(a => a.entry_id && a.purpose === "node")) {
        const node = nodes.find(n => n.type === binding.node_type && n.id === binding.node_id);
        const entry = assignments.find(a => a.id === binding.entry_id);
        records.push({ ...binding, id: `binding-${binding.id}`, name: node?.name || `#${binding.node_id}`, entry: `${entry?.domain || "入口待检查"}:${binding.entry_port}`, active: `${binding.published_domain}:${binding.published_port || node?.port || "—"} → ${binding.published_origin || binding.domain}:${node?.server_port || "—"}`, node });
    }
    return <Panel title="入口转发"><State {...data} retry={data.reload}><p className="muted">此处汇总所有服务器的转发线路；单台服务器请在“服务器列表 → 管理 → 本机入口转发”集中配置。与节点编辑共用相同的接入关系。复制 Nginx 配置到入口服务器，检查并加载后完成连接测试。面板不自动安装转发。</p><Table data={records} columns={[["name", "接入线路"], ["entry", "已保存入口"], ["active", "当前发布路径"]]} actions={r => <button disabled={!r.node} onClick={() => edit(r.node)}>{r.node?.service_id ? "编辑线路" : "配置转发与验证"}</button>} /></State></Panel>;
}
