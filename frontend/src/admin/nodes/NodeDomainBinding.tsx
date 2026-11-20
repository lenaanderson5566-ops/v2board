import { NodeDnsObservation } from "../NodeDnsObservation";
import { NodeAddressSummary } from "../NodeAddressSummary";
import { ManualNodeAddress } from "../ManualNodeAddress";
import { relayStreamConfig, relayCertificateIssue } from "../node-relay";
import { useEffect, useRef, useState } from "react";
import { admin, query, request, type Row } from "../../shared/api";
import { State, Table, useData } from "../../shared/ui";
import { AdminLogTimeZone, logTime } from "../admin-log-time";
import { NodeNetworkSetup } from "../NodeNetworkSetup";
import { nodeDomainProgress } from "../node-domain-progress";
import { domainStatus } from "./domain-status";

export function NodeDomainBinding({
    pauseRefresh = false,
    onDirty,
    onBusyChange,
    node,
    onChanged,
    onPublished,
    onUpgrade,
}: {
    node: Row;
    pauseRefresh?: boolean;
    onChanged?: () => void;
    onDirty?: (dirty:boolean)=>void;
    onBusyChange?: (busy:boolean)=>void;
    onPublished?: () => void;
    onUpgrade?: () => void;
}) {
    const data = useData<Row>(admin("server/ddns/fetch"));
    const roots: Row[] = (data.data?.credentials || []).filter(
        (c: Row) => c.root_domain,
    );
    const configuredBinding: Row | undefined = (data.data?.assignments || []).find(
        (a: Row) => a.node_type === node.type && a.node_id === node.id,
    );
    const binding=configuredBinding?.status==="manual" ? undefined : configuredBinding;
    const candidate = binding?.relay_cutover;
    const [testedProof, setTestedProof] = useState("");
    useEffect(() => setTestedProof(""), [candidate?.proof]);
    const servers: Row[] = data.data?.servers || [];
    const entries: Row[] = (data.data?.assignments || []).filter(
        (a: Row) => a.purpose === "entry" && a.enabled,
    );
    const [draftRevision,setDraftRevision]=useState<string | undefined>();
    const [serverId, setServerId] = useState("");
    const [mode, setMode] = useState("direct");
    const certificateIssue = mode === "relay" ? relayCertificateIssue(node) : "";
    const [entryId, setEntryId] = useState("");
    const [entryPort, setEntryPort] = useState(String(node.port || 443));
    const entry = entries.find((a) => a.id === binding?.entry_id);
    const [root, setRoot] = useState(""),
        [prefix, setPrefix] = useState(""),
        [family, setFamily] = useState("ipv4");
    const [manualDirty,setManualDirty]=useState(false),[formDirty,setFormDirty]=useState(false),[manualBusy,setManualBusy]=useState(false);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [notice, setNotice] = useState("");
    useEffect(()=>onBusyChange?.(busy || manualBusy),[busy,manualBusy,onBusyChange]);
    useEffect(()=>onDirty?.(manualDirty || formDirty),[manualDirty,formDirty,onDirty]);
    useEffect(()=>{
        if(!formDirty)return;
        const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
        window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
    },[formDirty]);
    const [adoption, setAdoption] = useState<Row | null>(null);
    const [originCleanup, setOriginCleanup] = useState<Row | null>(null);
    useEffect(()=>setOriginCleanup(null),[configuredBinding?.configuration_revision]);
    const pending = useRef(false);
    const progress = binding ? nodeDomainProgress(binding, node) : null;
    const lastPublished = useRef({ domain: node.host, port: node.port });
    useEffect(() => {
        if (
            !binding?.published_domain ||
            (binding.published_domain === lastPublished.current.domain &&
                (!binding.published_port ||
                    Number(binding.published_port) ===
                        Number(lastPublished.current.port)))
        )
            return;
        lastPublished.current = {
            domain: binding.published_domain,
            port: binding.published_port || lastPublished.current.port,
        };
        onPublished?.();
    }, [binding?.published_domain, binding?.published_port, onPublished]);
    useEffect(() => {
        if (pauseRefresh || !binding?.enabled || data.loading || data.error || busy || adoption || originCleanup)
            return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") data.reload();
        }, 15000);
        return () => window.clearInterval(timer);
    }, [
        binding?.enabled,
        pauseRefresh,
        data.loading,
        data.error,
        data.reload,
        busy,
        adoption,
        originCleanup,
    ]);
    useEffect(() => {
        if (configuredBinding && !formDirty) {
            setDraftRevision(configuredBinding.configuration_revision);
            setServerId(String(configuredBinding.server_id || ""));
            setMode(configuredBinding.entry_id ? "relay" : "direct");
            setEntryId(String(configuredBinding.entry_id || ""));
            setEntryPort(String(configuredBinding.entry_port || node.port || 443));
            setRoot(String(configuredBinding.credential_id));
            setFamily(configuredBinding.family);
            const c = (data.data?.credentials || []).find(
                (r: Row) => r.id === configuredBinding.credential_id,
            );
            if (c?.root_domain && configuredBinding.domain.endsWith("." + c.root_domain))
                setPrefix(configuredBinding.domain.slice(0, -c.root_domain.length - 1));
        }
    }, [
        formDirty,
        configuredBinding?.configuration_revision,
        configuredBinding?.id,
        configuredBinding?.domain,
        configuredBinding?.family,
        configuredBinding?.server_id,
        configuredBinding?.entry_id,
        configuredBinding?.entry_port,
    ]);
    async function act(path: string, payload: Row) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const r = await request<Row>(
                admin(`server/domains/${path}`),
                payload,
            );
            data.reload();
            if(path === "bind" || path === "manual") setFormDirty(false);
            onChanged?.();
            setNotice(
                path === "bind"
                    ? r.data.unchanged ? "域名配置未变化，现有解析和证书验证状态已保留。" : "域名已保存。直连节点在解析和节点验证通过后启用；已上线线路更换中转入口时，请用客户端测试候选入口，再确认切换订阅。"
                    : path === "activate"
                      ? payload.relayProof ? "候选入口已验证，订阅已切换。" : "已提交启用请求，请查看上方进度。"
                      : path === "retry"
                        ? "已安排 DNS 同步，将由下一轮后台调度执行。同步使用最近上报的服务器 IP，不会重启节点或切换订阅地址。"
                      : path === "manual" ? "已改为手动维护。现有解析、服务器关联和节点证书保持不变，DNS 不再自动更新。" : "操作已完成",
            );
            return r.data;
        } catch (e) {
            setError((e as Error).message);
            if (payload.relayProof) data.reload();
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    async function reviewOriginCleanup(confirmCleanup = false) {
        if (pending.current || !binding) return;
        if (confirmCleanup && (!originCleanup || !window.confirm("确认安排清理预览中可清理的旧回源解析？24 小时后才会删除，仍被节点或证书引用的记录会保留。请先验证入口转发及客户端连接正常。"))) return;
        pending.current = true;
        setBusy(true); setError(""); setNotice("");
        if (!confirmCleanup) setOriginCleanup(null);
        try {
            const path=admin("server/network/origin-cleanup");
            const result=confirmCleanup
                ? await request<Row>(path,{id:binding.id,proof:originCleanup!.proof,confirm:true})
                : await request<Row>(query(path,{id:binding.id}));
            if (confirmCleanup) {
                setOriginCleanup(null);
                setNotice(`已安排 ${result.data.scheduled} 条旧回源解析在 24 小时后清理，其他解析、节点和证书保持不变。`);
                data.reload();
            } else setOriginCleanup(result.data);
        } catch(e) { setOriginCleanup(null); setError((e as Error).message); }
        finally { pending.current=false; setBusy(false); }
    }
    return (
        <section className="admin-deployment-card">
            <h3>连接与域名</h3>
            <State {...data} retry={data.reload}>
                {binding && (
                    <div>
                        <NodeDnsObservation observation={binding.deployment_dns} />
                        {progress && (
                            <div className="node-domain-progress">
                                <ol aria-label="域名启用进度">
                                    {[
                                        ["保存域名", true],
                                        ["IP 上报", progress.reportsReady],
                                        ["解析同步", progress.dnsReady],
                                        ["启用域名", progress.active],
                                    ].map(([label, done], index) => (
                                        <li
                                            key={String(label)}
                                            data-done={done ? "true" : "false"}
                                        >
                                            <span>
                                                {done ? "✓" : index + 1}
                                            </span>
                                            {label}
                                            <small>
                                                {done
                                                    ? "已完成"
                                                    : index === 3 &&
                                                        progress.pending
                                                      ? "验证中"
                                                      : "待完成"}
                                            </small>
                                        </li>
                                    ))}
                                </ol>
                                <h4>{progress.title}</h4>
                                <p>{progress.description}</p>
                            </div>
                        )}
                        <NodeAddressSummary node={node} binding={binding} entry={entry} />
                        {entry && (
                            <>
                                <p>
                                    入口服务器：
                                    {servers.find(
                                        (s) => s.id === entry.server_id,
                                    )?.name || "—"}{" "}
                                    · 回源服务器：
                                    {servers.find(
                                        (s) => s.id === binding.server_id,
                                    )?.name || "—"}
                                </p>
                                <p>
                                    此前保留的回源：
                                    {binding.published_origin || "尚未确认"}
                                    {binding.published_origin &&
                                    binding.published_origin !== binding.domain
                                        ? " · 请将转发配置更新到新回源域名，测试通过后可在高级维护中清理旧回源解析。旧解析不会因部署完成而自动删除。"
                                        : ""}
                                </p>
                                <p className="muted">
                                    入口服务器只转发 TCP／UDP，不解密 TLS；代理服务器上的 V2Box 负责证书与加密连接。证书匹配独立 TLS 身份域名，不要求与入口域名相同。请在入口配置转发至{" "}
                                    {binding.domain}:{node.server_port}。
                                </p>
                                <details>
                                    <summary>入口转发配置</summary>
                                    <p className="muted">
                                        适用于 Nginx 1.27.3 及以上版本，并需启用
                                        stream 模块。将以下片段放入已有 stream
                                        配置，确认监听端口未被占用，再执行 nginx
                                        -t，检查通过后重载。DNS
                                        解析变化会自动更新回源地址。
                                    </p>
                                    <pre className="admin-network-command">
                                        {relayStreamConfig(
                                            binding,
                                            node,
                                            entry,
                                        ) || "请先设置有效的节点监听端口。"}
                                    </pre>
                                    <button type="button" disabled={busy || !relayStreamConfig(binding,node,entry)} onClick={async()=>{try{await navigator.clipboard.writeText(relayStreamConfig(binding,node,entry));setNotice("转发配置已复制，请在入口服务器检查并加载。");}catch{setError("复制失败，请手动复制配置。");}}}>复制转发配置</button>
                                    <p className="muted">
                                        入口按节点协议开放 TCP／UDP
                                        端口。节点防火墙需允许入口服务器访问监听端口；此配置不启用
                                        PROXY protocol。
                                    </p>
                                </details>
                                {candidate ? <section className="admin-deployment-card" aria-label="验证候选入口">
                                    <h3>验证候选入口</h3>
                                    <p>在客户端使用 {candidate.host}:{candidate.port} 测试 {candidate.protocol || node.protocol} 连接。确认前，订阅继续使用 {candidate.previousHost}:{candidate.previousPort}，请保留旧入口的转发规则。</p>
                                    {candidate.serverName && <p>TLS 身份域名：{candidate.serverName}</p>}
                                    {candidate.certificateFingerprint && <p>证书 SHA-256 指纹：<code>{candidate.certificateFingerprint}</code></p>}
                                    {!candidate.ready && <p>等待回源配置、证书与解析就绪后可确认。</p>}
                                    <label className="node-quota-filter"><input type="checkbox" checked={!!candidate.proof && testedProof === candidate.proof}
                                        disabled={!candidate.ready || !candidate.proof || busy || manualBusy || formDirty || manualDirty}
                                        onChange={e => setTestedProof(e.target.checked ? candidate.proof : "")} />已通过候选入口完成客户端连接测试</label>
                                    <button className="primary" disabled={!candidate.ready || !candidate.proof || testedProof !== candidate.proof || busy || manualBusy || formDirty || manualDirty}
                                        onClick={() => {
                                            if (!window.confirm(`确认将订阅入口切换为 ${candidate.host}:${candidate.port}？`)) return;
                                            setTestedProof("");
                                            void act("activate", {id: binding.id, confirm: true, clientTested: true, relayProof: candidate.proof});
                                        }}>确认并切换订阅入口</button>
                                </section> : <p>在入口服务器加载转发配置后，请通过该入口完成实际客户端连接测试。</p>}
                                <details className="admin-deployment-tools">
                                    <summary>高级维护：旧回源解析</summary>
                                    <p className="muted">仅在更换回源域名后使用。先确认入口转发已使用当前回源，且客户端连接正常；预览不会改动任何解析。确认清理后仍保留 24 小时，不会重启节点或更改证书。</p>
                                    <button disabled={busy || manualBusy || formDirty || manualDirty} onClick={()=>void reviewOriginCleanup()}>预览旧回源解析</button>
                                    {originCleanup && <>
                                        <Table data={originCleanup.rows || []} columns={[
                                            ["domain","旧域名"],["type","类型"],["ip","当前 IP"],
                                            ["reason","处理说明"],
                                        ]}/>
                                        {!originCleanup.rows?.length && <p>没有需要清理的旧回源解析。</p>}
                                        <div className="actions">
                                            <button type="button" className="danger" disabled={busy || manualBusy || formDirty || manualDirty || !originCleanup.rows?.some((r:Row)=>r.action==="schedule")} onClick={()=>void reviewOriginCleanup(true)}>确认延迟清理</button>
                                            <button type="button" disabled={busy} onClick={()=>setOriginCleanup(null)}>取消预览</button>
                                        </div>
                                    </>}
                                </details>
                            </>
                        )}
                        <p>
                            解析状态：
                            {domainStatus[binding.status] || binding.status}
                        </p>
                        <details className="node-domain-evidence"><summary>服务器上报与解析记录</summary>
                        <AdminLogTimeZone />
                        {(binding.family === "dual"
                            ? ["ipv4", "ipv6"]
                            : [binding.family]
                        ).map((family) => {
                            const seen = Number(binding[`${family}_seen_at`]);
                            return (
                                <p key={family}>
                                    {family === "ipv4" ? "IPv4" : "IPv6"} 上报：
                                    {binding[family] || "尚未收到"} · 最近上报：
                                    {seen ? logTime(seen) : "—"}
                                    {seen > 0 && seen < Date.now() / 1000 - 900
                                        ? " · 已超过 15 分钟，请检查上报服务"
                                        : ""}
                                </p>
                            );
                        })}
                        <p>
                            最近解析同步：
                            {binding.last_success
                                ? logTime(binding.last_success)
                                : "—"}
                        </p>
                        </details>
                        {!binding.ipv4 && !binding.ipv6 && (
                            <p className="muted">
                                尚未收到独立 IP 上报。节点列表的 IP
                                也可能来自连接面板时的出口地址。
                                新节点请执行一键部署；已部署节点可在高级维护中修复上报。若部署尚未完成，请先执行恢复命令。
                            </p>
                        )}
                        <div className="actions">
                            {progress?.needsUpgrade && onUpgrade && (
                                <button
                                    className="primary"
                                    disabled={busy || manualBusy}
                                    onClick={onUpgrade}
                                >
                                    查看节点升级命令
                                </button>
                            )}
                            {binding.managed && (
                                    <button
                                        disabled={busy || manualBusy}
                                        onClick={async () => {
                                            const r = await act("adopt", {
                                                id: binding.id,
                                            });
                                            if (r) setAdoption(r);
                                        }}
                                    >
                                        核对已有解析
                                    </button>
                                )}

                            <button
                                disabled={busy || data.loading}
                                onClick={data.reload}
                            >
                                刷新状态
                            </button>
                            {!progress?.dnsReady && !progress?.pending && (
                                <button
                                    disabled={
                                        busy ||
                                        !binding.managed ||
                                        !binding.enabled ||
                                        !progress?.reportsReady
                                    }
                                    onClick={() =>
                                        act("retry", { id: binding.id })
                                    }
                                >
                                    重试 DNS 同步
                                </button>
                            )}
                            {!candidate && progress?.canActivate && (binding.entry_id || binding.tls_transition_state === "failed" || ["manual_required","configuration_blocked"].includes(binding.automatic_status) || ["hysteria2","tuic"].includes(node.protocol) && Number(node.tls)!==1) && (
                                <button
                                    className="primary"
                                    disabled={busy || manualBusy}
                                    onClick={() => {
                                        if (
                                            window.confirm(
                                                `确认将节点连接地址切换为 ${binding.domain}？普通 TLS 节点将先验证新证书与监听，再更新连接地址；中转保留落地 TLS 身份和证书；失败保留原配置。Reality 仅更新连接地址，旧托管解析至少保留 24 小时。`,
                                            )
                                        )
                                            void act("activate", {
                                                id: binding.id,
                                                confirm: true,
                                            });
                                    }}
                                >
                                    验证并切换地址
                                </button>
                            )}
                        </div>

                        {node.type === "v2box" &&
                            !node._new &&
                            !progress?.pending &&
                            !progress?.reportsReady && (
                                <details className="admin-deployment-tools">
                                    <summary>高级维护</summary>
                                    <div>
                                        <p className="muted">
                                            仅用于已安装节点缺少上报或上报异常。一键部署已包含此步骤；未完成部署请先执行{" "}
                                            <code>
                                                sh install-v2box.sh --resume
                                            </code>
                                            。
                                        </p>
                                        <NodeNetworkSetup
                                            node={node}
                                            disabled={busy || !binding.enabled}
                                        />
                                    </div>
                                </details>
                            )}
                    </div>
                )}
                {configuredBinding?.status==="manual" && <p className="muted">节点服务器：{servers.find(s=>Number(s.id)===Number(configuredBinding.server_id))?.name || "未关联"}；现有生效解析保留，自动同步已暂停。</p>}
                {!binding && <ManualNodeAddress disabled={busy} node={node} onChanged={onPublished} onDirty={setManualDirty} onBusyChange={setManualBusy}/> }
                <details className="node-domain-settings" open={!binding}>
                    <summary>
                        {binding ? "修改域名设置" : "设置节点域名"}
                    </summary>
                    {!roots.length ? (
                        <p>请先在 域名与解析 中添加并验证根域名。</p>
                    ) : (
                        <form
                            className="node-domain-form"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (certificateIssue) { setError(certificateIssue); return; }
                                void act("bind", {
                                    ...(draftRevision ? {revision:draftRevision}:{}),
                                    node_type: node.type,
                                    node_id: node.id,
                                    credential_id: Number(root || roots[0]?.id),
                                    prefix,
                                    family,
                                    server_id: serverId
                                        ? Number(serverId)
                                        : null,
                                    entry_id:
                                        mode === "relay"
                                            ? Number(entryId)
                                            : null,
                                    entry_port:
                                        mode === "relay"
                                            ? Number(entryPort)
                                            : null,
                                });
                            }}
                        >
                            <details className="admin-deployment-tools" open={node._new || mode === "relay"}>
                                <summary>连接路径：直连或中转</summary>
                                <div className="node-domain-form">
                            <label>
                                接入方式
                                <select
                                    aria-label="接入方式"
                                    disabled={busy || manualBusy}
                                    value={mode}
                                    onChange={(e) => {setFormDirty(true);setMode(e.target.value);}}
                                >
                                    <option value="direct">直连（客户端直接连接代理服务器）</option>
                                    {node.type === "v2box" && (
                                        <option value="relay">
                                            中转连接（入口转发至代理服务器）
                                        </option>
                                    )}
                                </select>
                            </label>
                            <label>
                                代理服务器（运行 V2Box）
                                <select
                                    aria-label="节点服务器"
                                    disabled={busy || manualBusy}
                                    value={serverId}
                                    onChange={(e) => {setFormDirty(true);setServerId(e.target.value);}}
                                >
                                    <option value="">
                                        自动关联服务器（无需单独配置）
                                    </option>
                                    {servers
                                        .filter((s) => s.enabled)
                                        .map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))}
                                </select>
                            </label>
                            {mode === "relay" && (
                                <>
                                    <section className="admin-deployment-card" aria-label="中转连接配置说明">
                                        <strong>客户端 → 入口服务器 → 代理服务器</strong>
                                        <p>入口负责转发，V2Box 安装在代理服务器。入口域名解析到入口 IP，回源域名解析到代理服务器 IP。</p>
                                        {Number(node.tls) === 1 && <p>证书使用独立 TLS 身份域名，参数在节点编辑的“连接与协议 → 协议与证书”中维护。</p>}
                                        {Number(node.tls) === 2 && <p>Reality 使用独立的握手配置，无需申请上述 TLS 域名证书。</p>}
                                    </section>
                                    <label>
                                        入口域名（客户端连接地址）
                                        <select
                                            aria-label="共享入口域名"
                                            required
                                            disabled={busy || manualBusy}
                                            value={entryId}
                                            onChange={(e) => {setFormDirty(true);setEntryId(e.target.value);}}
                                        >
                                            <option value="">选择入口</option>
                                            {entries.map((a) => (
                                                <option key={a.id} value={a.id}>
                                                    {a.domain}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        入口端口（客户端连接端口）
                                        <input
                                            aria-label="入口端口"
                                            type="number"
                                            min={1}
                                            max={65535}
                                            required
                                            value={entryPort}
                                            disabled={busy || manualBusy}
                                            onChange={(e) => {setFormDirty(true);setEntryPort(e.target.value);}}
                                        />
                                    </label>
                                    <p className="muted">
                                        入口域名指向中转服务器，回源域名指向代理服务器。入口与回源可使用不同地址类型。
                                    </p>
                                </>
                            )}
                                </div>
                            </details>
                            <label>
                                {mode === "relay" ? "回源根域名（指向代理服务器）" : "连接根域名（指向代理服务器）"}
                                <select
                                    aria-label="根域名"
                                    disabled={busy || manualBusy}
                                    value={root || roots[0]?.id || ""}
                                    onChange={(e) => {setFormDirty(true);setRoot(e.target.value);}}
                                >
                                    {roots.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.root_domain}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                子域名前缀
                                <input
                                    aria-label="子域名前缀"
                                    disabled={busy || manualBusy}
                                    value={prefix}
                                    maxLength={63}
                                    pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                                    placeholder="留空自动生成"
                                    onChange={(e) => {setFormDirty(true);setPrefix(e.target.value.toLowerCase());}}
                                />
                            </label>
                            <label>
                                地址类型
                                <select
                                    aria-label="地址类型"
                                    disabled={busy || manualBusy}
                                    value={family}
                                    onChange={(e) => {setFormDirty(true);setFamily(e.target.value);}}
                                >
                                    <option value="ipv4">IPv4 / A</option>
                                    <option value="ipv6">IPv6 / AAAA</option>
                                    <option value="dual">双栈</option>
                                </select>
                            </label>
                            {prefix && (
                                <p>
                                    {prefix}.
                                    {
                                        roots.find(
                                            (c) =>
                                                String(c.id) ===
                                                (root || String(roots[0]?.id)),
                                        )?.root_domain
                                    }
                                </p>
                            )}
                            {certificateIssue && <p role="alert" className="node-path-prerequisite">{certificateIssue}</p>}
                            <button disabled={busy || manualBusy || !!certificateIssue} className="primary">
                                保存域名
                            </button>
                            <button type="button" disabled={busy || manualBusy} onClick={()=>{
                                if(formDirty && !confirm("重新载入将放弃尚未保存的域名设置，确认继续？"))return;
                                setFormDirty(false);
                                if(!binding){setServerId("");setMode("direct");setEntryId("");setEntryPort(String(node.port || 443));setRoot("");setPrefix("");setFamily("ipv4");setDraftRevision(undefined);}
                                data.reload();
                            }}>重新载入域名设置</button>
                            {binding?.managed && <button type="button" className="danger" title={binding.tls_transition_state==="pending"?"请先完成证书验证":binding.entry_id || binding.published_origin?"中转节点请先切换直连并验证":undefined} disabled={busy || manualBusy || data.loading || !draftRevision || binding.tls_transition_state==="pending" || !!binding.entry_id || !!binding.published_origin} onClick={()=>{
                                if(!confirm("确认改为手动维护并放弃未保存的域名设置？现有解析和服务器关联保留，DNS 不再自动更新；复用线路或证书验证未完成时禁止切换。"))return;
                                void act("manual",{id:binding.id,revision:draftRevision,confirm:true});
                            }}>改为手动维护</button>}
                        </form>
                    )}
                </details>
            </State>
            {adoption && binding && (
                <div>
                    <h4>已有解析与处理预览</h4>
                    <Table
                        data={adoption.rows}
                        columns={[
                            ["name", "域名"],
                            ["type", "类型"],
                            ["content", "当前 IP"],
                            ["target", "目标 IP", (r: Row) => r.target || "—"],
                            ["action", "确认后的处理", (r: Row) => ({create:"创建目标解析",remove:"删除废弃记录",keep_unused:"保留（可能阻塞部署）",await_report:"等待有效 IP 上报后同步",adopt:"接管并保留 IP",update:"接管，随后同步目标 IP"} as Record<string,string>)[r.action] || "待核对"],
                        ]}
                    />
                    <p>仅处理当前绑定域名。接管后按服务器上报 IP 同步；不支持自动覆盖其他绑定、归属备注或重复记录。</p>
                    {adoption.rows?.some((r: Row) => r.unused) && <label><input type="checkbox" checked={!!adoption.removeUnused} disabled={busy} onChange={async e => {
                        const r = await act("adopt", {id: binding.id, removeUnused: e.target.checked});
                        setAdoption(r || null);
                    }}/>同时删除当前地址类型不再使用的 A/AAAA 记录（请确认未用于其他服务）</label>}
                    <button
                        type="button"
                        className={adoption.removeUnused ? "danger" : "primary"}
                        disabled={busy || !adoption.rows?.length}
                        onClick={async () => {
                            if (
                                !window.confirm(
                                    adoption.removeUnused ? "确认接管所需解析，并删除预览中标记的废弃记录？" : "确认将预览中的所需解析交由此节点管理？未勾选的废弃记录将保留。",
                                )
                            )
                                return;
                            const r = await act("adopt", {
                                id: binding.id,
                                proof: adoption.proof,
                                removeUnused: !!adoption.removeUnused,
                            });
                            if (r) setAdoption(null);
                        }}
                    >
                        确认处理
                    </button>
                    <button disabled={busy || manualBusy} onClick={() => setAdoption(null)}>
                        取消
                    </button>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
        </section>
    );
}
