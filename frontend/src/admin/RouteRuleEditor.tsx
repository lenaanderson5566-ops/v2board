import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Row } from "../shared/api";
import { AdminChoiceGroup } from "./AdminChoices";
import { buildRouteConfig, defaultRouteForm, readRouteForm, routeMatchLabels } from "./route-form";

const CodeEditor = lazy(() => import("./admin-code-editor").then(module => ({ default: module.AdminCodeEditor })));
export function RouteRuleEditor({ initial, onSave, onStateChange }: { initial: Row; onSave: (body: Row) => Promise<void>; onStateChange: (state: { busy: boolean; dirty: boolean }) => void }) {
    const [parsed] = useState(() => readRouteForm(initial.sing_box || {}));
    const [mode, setMode] = useState((!initial.id && !initial.copiedFrom) || parsed ? "visual" : "json");
    const [form, setForm] = useState<Row>(() => {
        const tag = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        return { ...defaultRouteForm, ...parsed, ...(!initial.id ? { outboundTag: `proxy-${tag}`, dnsTag: `dns-${tag}`, setTag: `set-${tag}` } : {}) };
    });
    const [remarks, setRemarks] = useState(initial.remarks || "");
    const [raw, setRaw] = useState(JSON.stringify(initial.sing_box || { route: { rules: [] } }, null, 2));
    const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState("");
    const pending = useRef(false);
    useEffect(() => onStateChange({ busy, dirty }), [busy, dirty, onStateChange]);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const change = (key: string, value: unknown) => { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); setError(""); };
    const text = (key: string, label: string, type = "text", required = true) => <label><span>{label}{required && " *"}</span><input aria-label={label} type={type} min={type === "number" ? 1 : undefined} max={type === "number" ? 65535 : undefined} step={type === "number" ? 1 : undefined} required={required} value={form[key] ?? ""} onChange={e => change(key, e.target.value)} /></label>;
    const select = (key: string, label: string, options: [string, string][]) => <label><span>{label}</span><select aria-label={label} value={form[key]} onChange={e => {
        change(key, e.target.value);
        if (key === "kind" && e.target.value === "dns" && !String(form.match).startsWith("domain")) change("match", "domain_suffix");
        if (key === "dnsType") change("dnsPort", ["udp", "tcp"].includes(e.target.value) ? 53 : e.target.value === "tls" ? 853 : 443);
    }}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>;
    let preview = "填写规则后可预览实际下发的配置。";
    try { preview = JSON.stringify(buildRouteConfig(form), null, 2); } catch { /* Incomplete drafts remain editable. */ }
    function switchMode(next: string) {
        if (next === mode) return;
        try {
            if (next === "json") setRaw(JSON.stringify(form.kind === "match" && !String(form.values).trim() ? { route: { rules: [] } } : buildRouteConfig(form), null, 2));
            else {
                const value = JSON.parse(raw);
                const result = readRouteForm(value) || (JSON.stringify(value) === '{"route":{"rules":[]}}' ? form : undefined);
                if (!result) throw new Error("此配置包含可视化表单未支持的字段，请继续使用高级 JSON，原配置已保留。");
                setForm(result);
            }
            setMode(next); setError("");
        } catch (e) { setError((e as Error).message); }
    }
    return <form className="editor route-rule-editor" onSubmit={async event => {
        event.preventDefault(); if (pending.current) return;
        pending.current = true; setBusy(true); setError("");
        try {
            let config: Row;
            if (mode === "visual") config = buildRouteConfig(form);
            else {
                try { config = JSON.parse(raw); } catch { throw new Error("sing-box 配置不是有效的 JSON"); }
                if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("sing-box 配置必须是 JSON 对象");
            }
            await onSave({ ...(initial.id ? { id: initial.id } : {}), remarks: remarks.trim(), backend: "v2box", action: "sing_box", sing_box: config });
            setDirty(false);
        } catch (e) { setError((e as Error).message); }
        finally { pending.current = false; setBusy(false); }
    }}>
        <fieldset className="infrastructure-form" disabled={busy}>
            <label>备注 *<input aria-label="备注" required maxLength={255} value={remarks} onChange={e => { setRemarks(e.target.value); setDirty(true); }} /></label>
            {!!initial.node_count && <p className="infrastructure-notice">此规则被 {initial.node_count} 个服务引用，保存后同步影响这些服务；可先复制规则再单独调整。</p>}
            <AdminChoiceGroup label="规则编辑方式" value={mode} options={[{ value: "visual", label: "可视化配置" }, { value: "json", label: "高级 JSON" }]} onChange={switchMode} disabled={busy} />
            {initial.copiedFrom && mode === "json" && <p className="muted">复制保留原配置标签。如需与原规则同时使用，请检查出口、DNS 和规则集标签是否冲突。</p>}
            {mode === "visual" ? <>
                {select("kind", "规则用途", [["match", "按条件匹配"], ["dns", "DNS 分流"], ["ruleset", "远程规则集"], ["default", "默认出口"]])}
                {["match", "dns"].includes(form.kind) && <>
                    {select("match", "匹配方式", Object.entries(routeMatchLabels).filter(([key]) => form.kind !== "dns" || key.startsWith("domain")))}
                    <label>匹配内容 *<textarea aria-label="匹配内容" required rows={5} placeholder={form.match === "port_range" ? "8000:9000\n10000:20000" : form.match === "ip_cidr" ? "192.0.2.0/24\n2001:db8::/32" : "每行一项，也可用逗号分隔"} value={form.values} onChange={e => change("values", e.target.value)} /></label>
                    <p className="muted">多项条件按“任一匹配”生效。域名不填写 https:// 或路径；域名后缀包含子域名。需要组合不同条件时使用高级 JSON。</p>
                    {form.match === "protocol" && <p className="muted">识别协议填写 tls、http、quic、dns 等。TCP/UDP 网络类型请在高级 JSON 中设置 network。</p>}
                </>}
                {form.kind === "ruleset" && <>{text("url", "HTTPS 规则集地址", "url")}{select("format", "规则集格式", [["binary", "二进制 .srs"], ["source", "JSON 源文件"]])}</>}
                {form.kind !== "dns" && <>
                    {form.kind !== "default" && select("action", "处理方式", [["reject", "阻断"], ["route", "转发到指定出口"]])}
                    {(form.kind === "default" || form.action === "route") && <>
                        {select("outbound", "出口方式", [["direct", "直连"], ["proxy", "代理服务器"]])}
                        {form.outbound === "proxy" && <>
                            {select("proxyType", "代理协议", [["socks", "SOCKS"], ["http", "HTTP"]])}
                            {text("server", "代理服务器")}{text("port", "代理端口", "number")}
                            {text("username", "代理用户名", "text", false)}{text("password", "代理密码", "password", false)}
                        </>}
                    </>}
                </>}
                {form.kind === "dns" && <>
                    {select("dnsType", "DNS 协议", [["https", "HTTPS"], ["tls", "TLS"], ["udp", "UDP"], ["tcp", "TCP"]])}
                    {text("dnsServer", "DNS 服务器")}{text("dnsPort", "DNS 端口", "number")}
                    {form.dnsType === "https" && text("dnsPath", "DNS 请求路径")}
                    {["https", "tls"].includes(form.dnsType) && text("dnsSni", "DNS TLS 域名", "text", false)}
                </>}
                <details><summary>查看生成的 sing-box 配置</summary><pre className="route-config-preview">{preview}</pre></details>
            </> : <>
                {!parsed && (initial.id || initial.copiedFrom) && <p className="muted">此规则含复杂或自定义配置，已完整保留在高级 JSON 中。</p>}
                <Suspense fallback={<span className="spinner" />}><CodeEditor label="sing-box 规则配置" value={raw} onChange={value => { setRaw(value); setDirty(true); setError(""); }} /></Suspense>
            </>}
            <p className="muted">保存为 sing-box 原生规则。服务按所选规则顺序合并；出口或 DNS 设置冲突时会拒绝保存。</p>
        </fieldset>
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="form-bottom"><button className="primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</button></div>
    </form>;
}
