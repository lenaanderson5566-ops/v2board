import { useRef, useState, type FormEvent } from "react";
import type { V10FastaiRelease } from "./v10-types";

const platforms = { windows: "Windows", macos: "macOS", android: "Android", linux: "Linux" };
const architectures = { x64: "Intel / AMD · x64", arm64: "ARM64 / Apple Silicon", arm: "ARM", x86: "x86" };

export function AdminFastaiDownloads({ initial, save }: { initial: V10FastaiRelease[]; save: (releases: V10FastaiRelease[]) => Promise<void> }) {
    const [releases, setReleases] = useState(initial);
    const currentDraft = useRef(releases);
    currentDraft.current = releases;
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    function update(index: number, values: Partial<V10FastaiRelease>) {
        setReleases(items => items.map((item, i) => i === index ? { ...item, ...values } : item));
        setMessage("");
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setMessage("");
        try {
            await save(releases);
            setMessage(currentDraft.current === releases ? "FastAI 下载与版本设置已保存" : "本次提交已保存；后续修改尚未保存");
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return <form className="pad" onSubmit={submit}>
        <h3>FastAI 客户端下载与更新</h3>
        <p className="muted">为每个平台和架构分别发布安装包。此处同时管理安装包下载地址和 App 更新策略。iOS 继续使用下方原有设置。</p>
        <fieldset style={{ border: 0, padding: 0 }}>
            {releases.map((release, index) => <fieldset key={index} className="pad" style={{ marginBottom: 16 }}>
                <legend>{platforms[release.platform]} · {release.architecture}</legend>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                    <label>平台<select value={release.platform} onChange={e => update(index, { platform: e.target.value as V10FastaiRelease["platform"] })}>{Object.entries(platforms).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                    <label>架构<select value={release.architecture} onChange={e => update(index, { architecture: e.target.value as V10FastaiRelease["architecture"] })}>{Object.entries(architectures).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                    <label>最新版本<input required placeholder="1.0.0" value={release.latestVersion} onChange={e => update(index, { latestVersion: e.target.value })} /></label>
                    <label>构建号<input required type="number" min={1} max={2100000000} value={release.latestBuild} onChange={e => update(index, { latestBuild: Number(e.target.value) })} /></label>
                    <label>最低支持版本<input required placeholder="1.0.0" value={release.minimumVersion} onChange={e => update(index, { minimumVersion: e.target.value })} /></label>
                    <label>发布时间（UTC）<input required placeholder="2026-10-06T00:00:00Z" value={release.publishedAt} onChange={e => update(index, { publishedAt: e.target.value })} /></label>
                </div>
                <label>安装包 HTTPS 下载地址<input required type="url" value={release.downloadUrl} onChange={e => update(index, { downloadUrl: e.target.value })} /></label>
                <label>安装包 SHA-256<input required pattern="[a-f0-9]{64}" value={release.sha256} onChange={e => update(index, { sha256: e.target.value })} /></label>
                <label>更新说明<textarea maxLength={12000} value={release.releaseNotes || ""} onChange={e => update(index, { releaseNotes: e.target.value })} /></label>
                <button type="button" onClick={() => { setReleases(items => items.filter((_, i) => i !== index)); setMessage(""); }}>移除此安装包</button>
            </fieldset>)}
            {!releases.length && <p className="muted">尚未发布 FastAI 安装包。</p>}
            <button type="button" disabled={releases.length >= 32} onClick={() => { setMessage(""); setReleases(items => [...items, { platform: "windows", architecture: "x64", channel: "stable", latestVersion: "", latestBuild: 1, minimumVersion: "", downloadUrl: "", sha256: "", publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), releaseNotes: "" }]); }}>添加平台安装包</button>
            <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存 FastAI 下载设置"}</button>
        </fieldset>
        {message && <p role="status">{message}</p>}
    </form>;
}
