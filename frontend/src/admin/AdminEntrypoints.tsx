import { request, admin } from "../shared/api";
import { useState, type FormEvent } from "react";
export interface ServiceEntrypoint { origin: string; enabled: boolean; priority: number }
export function AdminEntrypoints({ initial, publicKey, version, save }: { initial: ServiceEntrypoint[]; publicKey?: string; version: number; save: (entries: ServiceEntrypoint[]) => Promise<void> }) {
    const [entries, setEntries] = useState(initial);
    const [checks, setChecks] = useState<Record<string, string>>({});
    const [checking, setChecking] = useState<string | null>(null);
    async function check(origin: string) { setChecking(origin); try { const { data } = await request<{checkedAt: string; durationMs: number}>(admin("config/testFastaiEntrypoint"), { origin }); setChecks(values => ({...values, [origin]: `检查通过 · ${data.durationMs} ms · ${data.checkedAt}`})); } catch (error) { setChecks(values => ({...values, [origin]: (error as Error).message})); } finally { setChecking(null); } }
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    function update(index: number, patch: Partial<ServiceEntrypoint>) { setEntries(items => items.map((item, i) => i === index ? { ...item, ...patch } : item)); setMessage(""); }
    async function submit(event: FormEvent) { event.preventDefault(); if (busy) return; setBusy(true); setMessage(""); try { await save(entries); setMessage("服务入口已发布；客户端检查更新后生效"); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }
    return <form className="pad" onSubmit={submit}>
        <h3>FastAI 服务入口</h3>
        <p className="muted">配置提供网页与 /api/v10 的完整 HTTPS 服务域名。数值越小越优先；是否可达由客户端检测。此处不会修改浏览器允许来源。</p>
        <p>配置版本：{version}</p>
        {publicKey ? <label>客户端验签公钥<input readOnly value={publicKey} /></label> : <p role="alert">尚未配置签名密钥，动态入口发布不可用。请配置 FASTAI_ENTRYPOINT_SIGNING_SEED，并在客户端构建时设置对应公钥。</p>}
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            {entries.map((entry, index) => <div key={index} className="pad">
                <label>服务域名<input required type="url" placeholder="https://example.com" value={entry.origin} onChange={e => update(index, { origin: e.target.value })} /></label>
                <label>优先级<input required type="number" min={1} max={100} value={entry.priority} onChange={e => update(index, { priority: Number(e.target.value) })} /></label>
                <label><input type="checkbox" checked={entry.enabled} onChange={e => update(index, { enabled: e.target.checked })} />启用</label>
                <button type="button" disabled={!publicKey || checking !== null || !entry.origin} onClick={() => check(entry.origin)}>{checking === entry.origin ? "检查中…" : "检查服务"}</button>
                {checks[entry.origin] && <p role="status">{checks[entry.origin]}</p>}
                <button type="button" onClick={() => setEntries(items => items.filter((_, i) => i !== index))}>移除</button>
            </div>)}
            <button type="button" disabled={entries.length >= 16} onClick={() => setEntries(items => [...items, { origin: "", priority: items.length + 1, enabled: true }])}>添加服务域名</button>
            <button type="submit" disabled={!publicKey || !entries.length}>发布服务入口</button>
        </fieldset>
        {message && <p role="status">{message}</p>}
    </form>;
}
