import { ServerTrafficFields, trafficDraft, trafficPayload } from "./ServerTrafficFields";
import { ServerTrafficDetails, quotaState } from "./ServerTrafficDetails";
import { ServerTrafficBudgets } from "./ServerTrafficBudgets";
import { domainStatus } from "./NodeDomains";
import { AdminSwitch } from "./admin-switch";
import { useMemo, useRef, useState } from "react";
import { admin, request, rows, bytes, type Row } from "../shared/api";
import { Modal, Panel, Table, State, useData } from "../shared/ui";
import { logTime } from "./admin-log-time";

export function NetworkServers({
    data,
    reload,
}: {
    data: Row;
    reload: () => void;
}) {
    const servers: Row[] = data.servers || [];
    const budgets=useData<Row[]>(admin("server/traffic-budget/fetch"));
    const budgetMap=useMemo(()=>{
        const result=new Map<number,Row>(),owners=new Map<string,number>(),candidates=new Map<number,Row[]>();
        for(const a of data.assignments || [])if(a.node_type==="v2box" || a.node_type==="v2node")owners.set(`${a.node_type}:${a.node_id}`,Number(a.server_id));
        for(const b of rows(budgets.data)){
            if(b.networkServerId){result.set(Number(b.networkServerId),b);continue;}
            const ids=new Set<number>((b.nodes || []).map((n: Row)=>owners.get(`${n.type}:${n.id}`) || 0));
            if(ids.size===1 && !ids.has(0)){const id=[...ids][0];candidates.set(id,[...(candidates.get(id)||[]),b]);}
        }
        for(const [id,list] of candidates)if(!result.has(id) && list.length===1)result.set(id,list[0]);
        return result;
    },[budgets.data,data.assignments]);
    const budgetFor=(id: number)=>budgetMap.get(Number(id));
    const [detail,setDetail]=useState<Row | null>(null);
    const [legacyOpen,setLegacyOpen]=useState(false);
    const legacyNodes=useData<Row[]>(legacyOpen?admin("server/manage/getNodes"):"");
    function editServer(server: Row) {if(budgets.loading || budgets.error){setError("请先成功加载流量额度后再编辑服务器");return;}setKind("save");setEditing({...server,...trafficDraft(budgetFor(server.id))});}

    const entries: Row[] = (data.assignments || []).filter(
        (a: Row) => a.purpose === "entry",
    );
    const roots: Row[] = (data.credentials || []).filter(
        (a: Row) => a.root_domain,
    );
    const [editing, setEditing] = useState<Row | null>(null);
    const [kind, setKind] = useState("save");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [command, setCommand] = useState("");
    const [adoption, setAdoption] = useState<Row | null>(null);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    async function act(path: string, body: Row, domain = false) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            if(path==="save") {
                if(budgets.loading || budgets.error)throw new Error("请先成功加载流量额度后再保存");
                const traffic=trafficPayload(editing || {});
                const old=budgetFor(Number(body.id));
                if(old && (old.resetDay!==traffic.resetDay || old.countingMode!==traffic.countingMode || (traffic.limitBytes>0 && traffic.limitBytes<=Number(old.usedBytes))) && !confirm("此变更会重新计算当前周期用量，或立即限制达到额度的服务。确认保存？"))return;
                body={...body,traffic};
            }
            const r = await request<Row>(
                admin(`server/${domain ? "domains" : "network"}/${path}`),
                body,
            );
            if (path === "adopt")
                setAdoption(r.data?.rows ? { ...r.data, id: body.id } : null);
            if (r.data?.command) setCommand(r.data.command);
            reload();
            if(path==="save")budgets.reload();
            if (path === "retry") setNotice("已安排 DNS 同步，将由下一轮后台调度执行。同步使用服务器最近上报的 IP，不重启节点或切换线路。");
            setEditing(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return (
        <>
            <Panel
                title="服务器列表"
                actions={
                    <div className="actions">
                        <button
                            onClick={() => {
                                setKind("save");
                                setEditing({
                                    name: "",
                                    family: "ipv4",
                                    enabled: true,
                                    ...trafficDraft(),
                                });
                            }}
                        >
                            添加服务器
                        </button>
                        <button
                            disabled={!servers.length || !roots.length}
                            onClick={() => {
                                setKind("entry");
                                setEditing({
                                    server_id: servers[0]?.id,
                                    credential_id: roots[0]?.id,
                                    prefix: "",
                                    family: "ipv4",
                                });
                            }}
                        >
                            添加入口域名
                        </button>
                    </div>
                }
            >
                <div className="pad">
                    <p className="muted">
                        直连节点可自动创建服务器记录，无需重复添加。独立中转服务器在此配置 IP 上报与共享入口。
                        {" "}<a href="#/nodes">配置节点</a> · <a href="#/node-domains">管理根域名与解析</a>
                    </p>
                    <Table
                        data={servers}
                        columns={[
                            ["name", "服务器", r=><span>{r.name}{!r.enabled && <small className="muted"> · 已停用</small>}</span>],
                            ["quota", "周期用量 / 额度", (r: Row) => {
                                const b=budgetFor(r.id);
                                return budgets.loading ? "加载中" : budgets.error ? "加载失败" : !b ? "未设置" : <span className="server-quota-usage">{bytes(b.usedBytes || 0)} / {Number(b.limitBytes)>0?bytes(b.limitBytes):"不限量"}<small className={b.blocked || quotaState(b)==="接近额度" ? "server-quota-warning" : "muted"}>{quotaState(b)}</small>{Number(b.limitBytes)>0 && <progress aria-label={`${r.name} 额度使用比例`} max={100} value={Math.min(100,Number(b.usedBytes)/Number(b.limitBytes)*100)}/>}</span>;
                            }],
                            ["cycle", "周期起始日", (r: Row) => budgetFor(r.id)?`每月 ${budgetFor(r.id)!.resetDay} 日`:"—"],
                            ["usage", "关联用途", (r: Row) => {
                                const bindings=(data.assignments || []).filter((a: Row)=>Number(a.server_id)===Number(r.id));
                                const origins=new Set(bindings.filter((a: Row)=>a.purpose!=="entry").map((a: Row)=>`${a.node_type}:${a.node_id}`)).size;
                                const entryCount=bindings.filter((a: Row)=>a.purpose==="entry").length;
                                return [origins ? `${origins} 个代理服务` : "", entryCount ? `${entryCount} 个入口域名` : ""].filter(Boolean).join(" · ") || "尚未关联";
                            }],
                            ["address", "IP 地址", r=><span>{r.ipv4 || "—"}{r.ipv6 && <small className="muted" style={{display:"block"}}>{r.ipv6}</small>}</span>],
                            [
                                "ipv4_seen_at",
                                "最近上报",
                                (r: Row) =>
                                    Math.max(Number(r.ipv4_seen_at) || 0, Number(r.ipv6_seen_at) || 0)
                                        ? logTime(
                                              Math.max(
                                                  Number(r.ipv4_seen_at) || 0,
                                                  Number(r.ipv6_seen_at) || 0,
                                              ),
                                          )
                                        : "尚未上报",
                            ],
                            [
                                "actions",
                                "操作",
                                (r: Row) => (
                                    <div className="actions">
                                        <button disabled={busy} onClick={()=>setDetail(r)}>详情</button>
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                editServer(r);
                                            }}
                                        >
                                            编辑
                                        </button>
                                        <button
                                            disabled={busy || !r.enabled}
                                            onClick={() =>
                                                act("enroll", { id: r.id })
                                            }
                                        >
                                            配置服务器上报
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                if (
                                                    confirm(
                                                        `删除服务器「${r.name}」？有关联域名时将禁止删除。`,
                                                    )
                                                )
                                                    act("drop", { id: r.id });
                                            }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                ),
                            ],
                        ]}
                    />
                    <h3>共享入口域名</h3>
                    <Table
                        data={entries}
                        columns={[
                            ["domain", "入口域名"],
                            [
                                "server_id",
                                "入口服务器",
                                (r: Row) =>
                                    servers.find((s) => s.id === r.server_id)
                                        ?.name || "—",
                            ],
                            [
                                "status",
                                "解析状态",
                                (r: Row) => domainStatus[r.status] || r.status,
                            ],
                            [
                                "references",
                                "关联线路",
                                (r: Row) =>
                                    r.connection_count ?? (data.assignments || []).filter(
                                        (a: Row) => a.entry_id === r.id,
                                    ).length,
                            ],
                            [
                                "actions",
                                "操作",
                                (r: Row) => (
                                    <div className="actions">
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                setKind("entry");
                                                setEditing({
                                                    ...r,
                                                    prefix: r.domain.slice(
                                                        0,
                                                        -(
                                                            roots.find(
                                                                (c) =>
                                                                    c.id ===
                                                                    r.credential_id,
                                                            )?.root_domain
                                                                ?.length || 0
                                                        ) - 1,
                                                    ),
                                                });
                                            }}
                                        >
                                            编辑
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() =>
                                                act("retry", { id: r.id }, true)
                                            }
                                        >
                                            重试 DNS 同步
                                        </button>
                                        {r.status === "ownership_conflict" && (
                                            <button
                                                disabled={busy}
                                                onClick={() =>
                                                    act(
                                                        "adopt",
                                                        { id: r.id },
                                                        true,
                                                    )
                                                }
                                            >
                                                预览现有解析
                                            </button>
                                        )}
                                        <button
                                            disabled={busy}
                                            onClick={() => {
                                                if (
                                                    confirm(
                                                        "删除此入口域名及其托管解析？存在关联节点时禁止删除。",
                                                    )
                                                )
                                                    act("entry-drop", {
                                                        id: r.id,
                                                    });
                                            }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                ),
                            ],
                        ]}
                    />
                    <p className="muted">
                        已有节点的一键部署会配置所属服务器的上报。独立入口服务器只需配置上报，不安装或重启
                        V2Box。
                    </p>
                    {budgets.error && <p role="alert">流量额度加载失败，<button onClick={budgets.reload}>重试</button></p>}
                    {rows(budgets.data).some(b=>!b.networkServerId) && <details><summary>历史未关联额度</summary><p>保留历史用量。整理服务绑定后，编辑对应服务器即可自动关联；不会自动合并不同额度。</p><button onClick={()=>setLegacyOpen(true)}>整理历史额度</button></details>}
                </div>
            </Panel>
            {detail && <ServerTrafficDetails server={detail} close={()=>setDetail(null)} edit={()=>{editServer(detail);setDetail(null);}}/>}
            {legacyOpen && <Modal title="历史未关联额度" close={()=>setLegacyOpen(false)}><State {...legacyNodes} retry={legacyNodes.reload}><ServerTrafficBudgets legacyOnly nodes={rows(legacyNodes.data)} onSaved={()=>{budgets.reload();reload();}}/></State></Modal>}
            {adoption && (
                <Modal
                    title="接管入口解析"
                    close={() => !busy && setAdoption(null)}
                >
                    <Table
                        data={adoption.rows}
                        columns={[
                            ["name", "域名"],
                            ["type", "类型"],
                            ["content", "当前 IP"],
                        ]}
                    />
                    <p>
                        确认以上记录属于所选入口服务器后接管，后续仅按入口服务器上报的
                        IP 更新。
                    </p>
                    <button
                        disabled={busy || !adoption.rows?.length}
                        onClick={() =>
                            act(
                                "adopt",
                                { id: adoption.id, proof: adoption.proof },
                                true,
                            )
                        }
                    >
                        确认接管
                    </button>
                    {error && <p role="alert">{error}</p>}
                </Modal>
            )}
            {command && (
                <Modal title="配置服务器 IP 上报" close={() => setCommand("")}>
                    <p>
                        请在选中的实际服务器执行。授权限时、一次有效；配置失败时可重复执行原命令恢复。
                    </p>
                    <pre className="admin-network-command">{command}</pre>
                    <button
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(command);
                            } catch {
                                setError("复制失败，请手动选择命令复制");
                            }
                        }}
                    >
                        复制命令
                    </button>
                </Modal>
            )}
            {editing && (
                <Modal
                    variant="drawer"
                    title={kind === "save" ? "服务器信息" : "入口域名"}
                    close={() => !busy && setEditing(null)}
                >
                    <form
                        className={`node-domain-form ${kind === "save" ? "server-config-form" : ""}`}
                        onSubmit={(e) => {
                            e.preventDefault();
                            act(
                                kind,
                                kind === "save"
                                    ? {
                                          id: editing.id,
                                          name: editing.name,
                                          family: editing.family,
                                          enabled: !!editing.enabled,
                                      }
                                    : {
                                          id: editing.id,
                                          server_id: Number(editing.server_id),
                                          credential_id: Number(
                                              editing.credential_id,
                                          ),
                                          prefix: editing.prefix,
                                          family: editing.family,
                                      },
                            );
                        }}
                    >
                        {kind === "save" ? (
                            <>
                                <label>
                                    服务器名称
                                    <input
                                        required
                                        maxLength={100}
                                        value={editing.name}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                name: e.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    允许 IP 上报与解析同步
                                    <AdminSwitch
                                        label="允许 IP 上报与解析同步"
                                        checked={!!editing.enabled}
                                        onChange={async (checked) => {
                                            setEditing({
                                                ...editing,
                                                enabled: checked,
                                            });
                                        }}
                                    />
                                </label>
                            </>
                        ) : (
                            <>
                                <label>
                                    入口服务器
                                    <select
                                        value={editing.server_id}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                server_id: e.target.value,
                                            })
                                        }
                                    >
                                        {servers
                                            .filter((s) => s.enabled)
                                            .map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                    </select>
                                </label>
                                <label>
                                    根域名
                                    <select
                                        value={editing.credential_id}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                credential_id: e.target.value,
                                            })
                                        }
                                    >
                                        {roots.map((r) => (
                                            <option key={r.id} value={r.id}>
                                                {r.root_domain}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    子域名前缀
                                    <input
                                        required
                                        maxLength={63}
                                        pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                                        value={editing.prefix}
                                        onChange={(e) =>
                                            setEditing({
                                                ...editing,
                                                prefix: e.target.value.toLowerCase(),
                                            })
                                        }
                                    />
                                </label>
                            </>
                        )}
                        <label>
                            地址类型
                            <select
                                value={editing.family}
                                onChange={(e) =>
                                    setEditing({
                                        ...editing,
                                        family: e.target.value,
                                    })
                                }
                            >
                                <option value="ipv4">IPv4</option>
                                <option value="ipv6">IPv6</option>
                                <option value="dual">双栈</option>
                            </select>
                        </label>
                        {kind === "save" && <ServerTrafficFields value={editing} onChange={setEditing}/>}
                        <button className="primary" disabled={busy || (kind==="save" && (budgets.loading || !!budgets.error))}>
                            保存
                        </button>
                        {kind === "save" && editing.id && (
                            <button
                                type="button"
                                disabled={busy || !editing.enabled}
                                onClick={() => {
                                    if (
                                        confirm(
                                            "重置会使此服务器的旧上报凭据立即失效。需重新执行生成的命令，现有 DNS 记录保留。确认继续？",
                                        )
                                    )
                                        act("reset", {
                                            id: editing.id,
                                            confirm: true,
                                        });
                                }}
                            >
                                重置上报凭据
                            </button>
                        )}
                        {error && <p role="alert">{error}</p>}
                    </form>
                </Modal>
            )}
            {error && !editing && !adoption && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
        </>
    );
}
