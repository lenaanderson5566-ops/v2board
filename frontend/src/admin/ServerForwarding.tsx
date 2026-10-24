import { useMemo, useState } from "react";
import { admin, rows, type Row } from "../shared/api";
import { Table, Modal, State, useData } from "../shared/ui";
import { NodeDeployment } from "./NodeDeployment";
import { NodeConnectionEditor } from "./NodeConnections";
import { NodeDictionaryProvider } from "./node-dictionary";

export function serverPurpose(serverId:number,data:Row):string {
    const bindings=(data.assignments || []).filter((a:Row)=>Number(a.server_id)===Number(serverId));
    const entry=bindings.some((a:Row)=>a.purpose==="entry");
    const proxy=bindings.some((a:Row)=>a.purpose!=="entry");
    return entry ? proxy ? "混合用途（入口与代理）" : "中转入口服务器" : proxy ? "代理服务器" : "待配置用途";
}

// Read the existing DNS projection only; draft and published ownership can differ.
export function serverForwardingRows(serverId: number, data: Row): Row[] {
    const assignments: Row[] = data.assignments || [];
    const byId = new Map(assignments.map((a) => [Number(a.id), a]));
    const entryByDomain = new Map(
        assignments
            .filter((a) => a.purpose === "entry")
            .map((a) => [a.domain, a]),
    );
    const onServer = (entry: Row | undefined) =>
        entry?.purpose === "entry" &&
        Number(entry.server_id) === Number(serverId);
    const result: Row[] = [];
    for (const c of data.connections || []) {
        const draft = byId.get(Number(c.entry_id)),
            published = c.published;
        const publishedHere =
            Number(published?.entry_server_id) === Number(serverId) &&
            !!published?.entry_id;
        if (!onServer(draft) && !publishedHere) continue;
        result.push({
            id: `connection-${c.id}`,
            node_type:c.node_type,node_id:c.node_id,
            name: `${String(c.node_type).toUpperCase()} · 线路 #${c.node_id}`,
            saved: draft
                ? `${draft.domain}:${c.entry_port}${onServer(draft) ? "" : "（其他服务器）"}`
                : "直连",
            active: published?.entry_id
                ? `${published.host}:${published.port} → ${published.origin_domain}:${published.origin_port}${publishedHere ? "" : "（其他服务器）"}`
                : published
                  ? "已发布直连"
                  : "尚未发布",
            status: !published
                ? "待检查与发布"
                : Number(c.entry_id) !== Number(published.entry_id) ||
                    Number(c.entry_port) !== Number(published.port) ||
                    (!!draft && draft.domain !== published.host)
                  ? "有待发布变更"
                  : "已发布；实际转发需在入口服务器验证",
        });
    }
    for (const a of assignments) {
        if (a.purpose !== "node") continue;
        const draft = byId.get(Number(a.entry_id));
        const publishedEntry = entryByDomain.get(a.published_domain);
        if (!onServer(draft) && !onServer(publishedEntry)) continue;
        result.push({
            id: `service-${a.id}`,
            node_type:a.node_type,node_id:a.node_id,
            name: `${String(a.node_type).toUpperCase()} · 服务 #${a.node_id}`,
            saved: a.entry_id
                ? `${draft?.domain || "入口待检查"}:${a.entry_port}${onServer(draft) ? "" : "（其他服务器）"}`
                : "直连（待启用）",
            active: a.published_domain
                ? `${a.published_domain}:${a.published_port || "—"} → ${a.published_origin || a.domain}`
                : "尚未启用",
            status:
                a.published_domain !== (draft?.domain || a.domain) ||
                (a.entry_id &&
                    Number(a.published_port) !== Number(a.entry_port))
                    ? "有待启用变更"
                    : a.relay_verified_at
                      ? "管理员已确认转发测试"
                      : "待配置入口转发并完成连接测试",
        });
    }
    return result;
}

export function ServerForwarding({ server, data, reload=()=>{} }: { server: Row; data: Row; reload?:()=>void }) {
    const [selected,setSelected]=useState<Row|null>(null);
    const records = useMemo(
        () => serverForwardingRows(Number(server.id), data),
        [server.id, data],
    );
    return (
        <><details className="admin-deployment-tools">
            <summary>本机入口转发（{records.length} 条）</summary>
            <p className="muted">
                集中维护本机入口转发，配置与节点共用。逐条检查入口端口和回源目标，复制配置到本服务器，检查并加载后完成连接验证；发布状态不能替代实际连接测试。
            </p>
            <Table
                data={records}
                columns={[
                    ["name", "线路 / 服务"],
                    ["saved", "已保存入口"],
                    ["active", "当前发布路径"],
                    ["status", "状态"],
                ]}
                actions={r=><button onClick={()=>setSelected(r)}>配置转发与验证</button>}
            />
            {!records.length && (
                <p>
                    先添加入口域名，再在新增节点中选择“入口中转”并指定本机入口。保存后在此配置转发。同台入口的监听端口不能重复。
                </p>
            )}
            <a href="#/nodes">新增或选择节点</a>
            <p className="muted">
                Nginx 转发配置在中转服务器加载；V2Box
                一键部署命令在运行代理服务的服务器执行。只添加入口域名或配置 IP
                上报不会安装转发。
            </p>
        </details>
        {selected && <ServerForwardingEditor record={selected} close={()=>setSelected(null)} reload={reload}/>}
        </>
    );
}

function ServerForwardingEditor({record,close,reload}:{record:Row;close:()=>void;reload:()=>void}) {
    const nodes=useData<Row[]>(admin("server/manage/getNodes"));
    const groups=useData<Row[]>(admin("server/group/fetch"));
    const node=rows(nodes.data).find(n=>n.type===record.node_type && Number(n.id)===Number(record.node_id));
    if(nodes.loading || groups.loading || nodes.error || groups.error || !node)return <Modal title="入口转发" close={close}><State loading={nodes.loading || groups.loading} error={nodes.error || groups.error || (!node ? "节点不可用，请刷新服务器列表后重试。" : "")} retry={()=>{nodes.reload();groups.reload();}}>{null}</State></Modal>;
    return <NodeDictionaryProvider>{node.service_id ? <NodeConnectionEditor node={node} nodes={rows(nodes.data)} groups={rows(groups.data)} close={close} onSaved={reload}/> : <NodeDeployment node={{...node,_focusDomain:true}} scope="connection" close={close} onChanged={reload}/>}</NodeDictionaryProvider>;
}
