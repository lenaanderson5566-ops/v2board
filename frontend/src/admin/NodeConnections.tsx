import { type ReactNode, useEffect, useRef, useState } from "react";
import { admin, query, request, type Row } from "../shared/api";
import { Modal, Panel, Table, State, useData } from "../shared/ui";
import { AdminSwitch } from "./admin-switch";
import { NodeTopology } from "./NodeTopology";
import { relayStreamConfig } from "./node-relay";
import { useNodeCatalog } from "./node-dictionary";

export function NodeConnectionEditor({ node, nodes, groups = [], close, onSaved, embedded=false, onDirty, onBusyChange, onCreated, navigation }: { navigation?:(busy:boolean,dirty:boolean)=>ReactNode; node: Row; nodes: Row[]; groups?: Row[]; close: () => void; onSaved: () => void; embedded?:boolean; onDirty?:(dirty:boolean)=>void; onBusyChange?:(busy:boolean)=>void; onCreated?:()=>void }) {
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
    useEffect(()=>onDirty?.(dirty),[dirty,onDirty]);
    useEffect(()=>onBusyChange?.(busy),[busy,onBusyChange]);
    useEffect(() => {
        if (!dirty || embedded) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty,embedded]);
    useEffect(() => { if (existing.data) { setDraft(existing.data.draft); setLoadedRevision(existing.data.revision ?? 0); setTagsText((existing.data.draft.tags || []).join(", ")); setDirty(false); setConfirmed(false); } }, [existing.data]);
    const selectableServices=embedded && !id ? nodes.filter(n=>!n.service_id) : services;
    const service = services.find(s => Number(s.id) === Number(draft.service_id));
    const assignments: Row[] = network.data?.assignments || [], servers: Row[] = network.data?.servers || [];
    const origin = assignments.find(a => a.node_type === type && a.node_id === Number(draft.service_id));
    const entries = assignments.filter(a => a.purpose === "entry" && a.enabled);
    const entry = entries.find(a => a.id === Number(draft.entry_id));
    const validEntry=!draft.entry_id || (!!entry && Number.isInteger(Number(draft.entry_port)) && Number(draft.entry_port)>=1 && Number(draft.entry_port)<=65535);
    const savedPlan = existing.data?.plan;
    const config = savedPlan?.entry_id ? relayStreamConfig({ id: existing.data?.id, scope: "connection", domain: savedPlan.origin_domain, family: savedPlan.origin_family, entry_port: savedPlan.port }, { ...service, server_port: savedPlan.origin_port, protocol: savedPlan.protocol }, { family: savedPlan.entry_family }) : "";
    function change(key: string, value: unknown) {
        setDraft(previous => {
            const next = { ...previous, [key]: value };
            if (key === "service_id") next.group_id = services.find(s => Number(s.id) === Number(value))?.group_id || [];
            return next;
        }); setDirty(true); setConfirmed(false); setNotice("");
    }
    function dismiss() { if (!busy && (!dirty || window.confirm("线路配置尚未保存，确认放弃修改？"))) close(); }
    async function act(publish = false) {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError(""); setNotice("");
        try {
            if(!publish && (!service || !draft.name.trim() || !validEntry))throw new Error("请检查代理服务、节点名称及入口端口配置");
            const body = publish ? { type, id, revision: existing.data?.revision, proof: savedPlan?.proof, confirmed } : { ...draft, type, id, revision: existing.data?.revision || 0, service_id: Number(draft.service_id), entry_id: draft.entry_id ? Number(draft.entry_id) : null, entry_port: draft.entry_id ? Number(draft.entry_port) : null };
            const result = await request<Row>(admin(`server/connections/${publish ? "publish" : "save"}`), body);
            if (!publish && !id) {setId(result.data.id);onCreated?.();} else existing.reload();
            setDirty(false); setConfirmed(false); onSaved();
            setNotice(publish ? "线路已发布，订阅将使用新的连接地址。" : "配置已保存，当前发布地址保持不变。请完成连接检查后发布。");
        } catch (e) { setError((e as Error).message); }
        finally { pending.current = false; setBusy(false); }
    }
    const content=<>
        <State loading={network.loading || existing.loading || (!!id && !existing.error && (!existing.data || loadedRevision !== (existing.data.revision ?? 0)))} error={network.error || existing.error} retry={() => { network.reload(); existing.reload(); }}>
            <div className="admin-deployment-card" data-unsaved={dirty || undefined} data-saving={busy || undefined}>
                <div className="field-section">线路信息</div>
                <div className="node-domain-form">
                    {!id && !embedded && <label>服务内核<select value={type} disabled={busy} onChange={e => { setType(e.target.value); change("service_id", ""); }}><option value="v2box">V2Box</option><option value="v2node">V2Node</option></select></label>}
                    <label>节点名称<input value={draft.name} disabled={busy} onChange={e => change("name", e.target.value)} /></label>
                    <label>代理服务<select value={embedded && !id ? (draft.service_id ? `${type}:${draft.service_id}` : "") : draft.service_id || ""} disabled={busy} onChange={e => {
                        if(embedded && !id){
                            const [backend,identity]=e.target.value.split(":");
                            const selected=selectableServices.find(s=>s.type===backend && Number(s.id)===Number(identity));
                            if(selected){setType(backend);setDraft(previous=>({...previous,service_id:selected.id,group_id:selected.group_id || []}));setDirty(true);setConfirmed(false);setNotice("");}
                            else change("service_id", "");
                        }else change("service_id", e.target.value);
                    }}><option value="">选择代理服务</option>{selectableServices.map(s => <option key={`${s.type}:${s.id}`} value={embedded && !id ? `${s.type}:${s.id}` : s.id}>{s.name} · {s.protocol} · {s.type=== "v2box" ? "V2Box" : "V2Node"}</option>)}</select></label>
                    {!id && !selectableServices.length && <p role="status">暂无可复用的代理服务，请选择“新建代理服务”。</p>}
                    <label>连接方式<select value={draft.entry_id ? "relay" : "direct"} disabled={busy} onChange={e => change("entry_id", e.target.value === "relay" ? entries[0]?.id || "pending" : "")}><option value="direct">直连</option><option value="relay">入口中转</option></select></label>
                    {!!draft.entry_id && !entry && <p role="status">请先在 <a href="#/servers">服务器管理</a> 中添加可用的入口域名。</p>}
                    {!!draft.entry_id && <><label>入口域名<select value={draft.entry_id} disabled={busy} onChange={e => change("entry_id", e.target.value)}><option value="pending">选择入口</option>{entries.map(e => <option key={e.id} value={e.id}>{e.domain} · {servers.find(s => s.id === e.server_id)?.name}</option>)}</select></label><label>入口端口<input type="number" min={1} max={65535} value={draft.entry_port || ""} disabled={busy} onChange={e => change("entry_port", e.target.value)} /></label></>}
                    <div><span>权限组</span><div className="option-group" role="group" aria-label="权限组">{(service?.group_id || []).map((g: number) => {
                        const selected = (draft.group_id || []).map(Number).includes(Number(g));
                        return <button type="button" role="checkbox" aria-checked={selected} disabled={busy} key={g} onClick={() => change("group_id", selected ? draft.group_id.filter((id: number) => Number(id) !== Number(g)) : [...draft.group_id, Number(g)])}><span className="option-check">{selected ? "✓" : ""}</span>{groups.find(group => Number(group.id) === Number(g))?.name || `权限组 #${g}`}</button>;
                    })}</div></div>
                    {service && <p className="muted">计费倍率：{service.rate ?? 1}，随共享服务设置。协议、监听和证书在保存后通过“服务配置”维护。</p>}
                    <label>发布后展示<AdminSwitch label="发布后展示" checked={!!Number(draft.show)} disabled={busy} onChange={async value => change("show", Number(value))} /></label>
                </div>
                <details><summary>线路展示信息</summary><div className="node-domain-form">
                    <label>国家 / 地区<select value={draft.region_code || ""} disabled={busy} onChange={e => { change("region_code", e.target.value || null); change("city_code", null); }}><option value="">使用节点名称</option>{Object.entries(catalog.regions).map(([code, names]) => <option key={code} value={code}>{names["zh-CN"] || names["en-US"]}</option>)}</select></label>
                    <label>州、省或城市<input value={draft.city_code || ""} list="connection-cities" disabled={busy} onChange={e => change("city_code", e.target.value || null)} /><datalist id="connection-cities">{Object.entries(catalog.cities).filter(([code]) => !draft.region_code || catalog.cityRegions[code] === draft.region_code).map(([code, names]) => <option key={code} value={code}>{names["zh-CN"] || names["en-US"]}</option>)}</datalist></label>
                    <label>线路编号 / 后缀<input value={draft.display_label || ""} disabled={busy} onChange={e => change("display_label", e.target.value || null)} /></label>
                    <label>标签（逗号分隔）<input value={tagsText} disabled={busy} onChange={e => { setTagsText(e.target.value); change("tags", e.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean)); }} /></label>
                </div></details>
                <NodeTopology service={service} origin={origin} entry={draft.entry_id ? entry || {} : undefined} server={servers.find(s => s.id === origin?.server_id)} entryServer={servers.find(s => s.id === entry?.server_id)} port={draft.entry_id ? draft.entry_port : service?.server_port} preview={dirty || !id} shared={entry?.connection_count || 0} />
                <button className="primary" disabled={busy || !dirty || !service || !draft.name.trim() || !validEntry} onClick={() => act()}>保存待发布配置</button>
                {existing.data && <p>当前发布地址：{existing.data.published ? `${existing.data.current.host}:${existing.data.current.port}` : node.id ? `${node.host}:${node.port}` : "尚未发布"}</p>}
                {!dirty && savedPlan && <section className="admin-deployment-card">
                    <h3>检查与发布</h3>
                    <p>{savedPlan.dns_ready ? "入口与回源解析已就绪。" : "等待服务器 IP 上报和解析同步。"}{savedPlan.transition_pending ? "代理服务证书正在切换，请等待完成。" : ""}</p>
                    {config && <details><summary>入口转发配置</summary><p>将此片段合并到入口服务器 Nginx 的 stream 配置，并替换该线路的旧片段。运行 nginx -t，通过后 reload。要求 Nginx 1.27.3 或更新版本。</p><pre className="admin-network-command">{config}</pre><button disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(config); setNotice("转发配置已复制。"); } catch { setError("复制失败，请手动复制配置。"); } }}>复制转发配置</button></details>}
                    <label className="node-quota-filter"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />已使用上述地址和代理服务身份完成客户端连接检查{config ? "，并确认入口转发配置已生效" : ""}</label>
                    <p className="muted">发布前再次检查服务配置回执。此确认记录为管理员验证，不代表系统已执行端到端探测。</p>
                    <button disabled={busy} onClick={() => { existing.reload(); network.reload(); }}>检查最新状态</button>{" "}<button className="primary" disabled={busy || !confirmed || !savedPlan.dns_ready || savedPlan.transition_pending} onClick={() => act(true)}>确认并发布线路</button>
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
    return <Panel title="入口转发"><State {...data} retry={data.reload}><p className="muted">在节点中维护入口与代理服务的对应关系；服务器详情汇总本机转发线路。复制 Nginx 配置到入口服务器，检查并加载后完成连接测试。面板不自动安装转发。</p><Table data={records} columns={[["name", "接入线路"], ["entry", "已保存入口"], ["active", "当前发布路径"]]} actions={r => <button disabled={!r.node} onClick={() => edit(r.node)}>{r.node?.service_id ? "编辑线路" : "配置转发与验证"}</button>} /></State></Panel>;
}
