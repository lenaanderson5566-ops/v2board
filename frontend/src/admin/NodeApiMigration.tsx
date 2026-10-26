import { useEffect, useState } from "react";
import { admin, date, request, type Row } from "../shared/api";

export function NodeApiMigration({ node, serverId }: { node?: Row; serverId?: number }) {
    const [oldApiHost, setOldApiHost] = useState("");
    const [migration, setMigration] = useState<Row | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!migration) return;
        const timer = setTimeout(() => { setMigration(null); setError("迁移授权已过期，请重新生成命令"); }, Math.max(0, Date.parse(migration.expiresAt) - Date.now()));
        return () => clearTimeout(timer);
    }, [migration]);
    async function generate() {
        setBusy(true); setError(""); setMigration(null); setCopied(false);
        try {
            const body = node ? { type: node.type, id: node.id, fromApiHost: oldApiHost.trim() } : { id: serverId, fromApiHost: oldApiHost.trim() };
            const result = await request(admin(node ? "server/credentials/migrate-api" : "server/network/migrate-api"), body);
            setMigration(result.data);
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    async function copy() {
        try { await navigator.clipboard.writeText(migration!.command); setCopied(true); }
        catch { setError("复制失败，请手动复制命令"); }
    }
    return <details className="admin-deployment-tools">
        <summary>{node ? "迁移节点 API 地址" : "迁移 IP 上报 API 地址"}</summary>
        <p>接入另一个独立后台时，直接执行该后台的一键部署命令，自动追加 Nodes。这里的迁移只用于同一后台更换域名，不用于合并不同后台。</p>
        <p>先在后台设置中保存新的 HTTPS 节点 API 地址，再填写服务器当前使用的旧地址。在对应服务器执行命令，保留现有密钥、证书及其他后台配置。旧域名需保持可访问；运行中的节点迁移时，该后台的连接可能重新建立。</p>
        {!node && <p>此入口用于独立 IP 上报服务器。若同时运行该后台的代理节点，请从节点部署页生成迁移命令，一并切换节点与上报地址。</p>}
        <label>原节点 API 地址<input aria-label="原节点 API 地址" value={oldApiHost} disabled={busy} onChange={e => { setOldApiHost(e.target.value); setMigration(null); }} placeholder="https://old-panel.example.com" /></label>
        <button disabled={busy || !oldApiHost.trim()} onClick={generate}>{busy ? "正在生成…" : "生成地址迁移命令"}</button>
        {migration && <>
            <p role="status">{migration.fromApiHost} → {migration.toApiHost}，授权有效至 {date(migration.expiresAt)}。执行前验证新旧域名属于同一后台；失败自动恢复原配置。</p>
            <textarea aria-label="节点 API 地址迁移命令" readOnly rows={4} spellCheck={false} value={migration.command} />
            <button onClick={copy}>复制迁移命令</button>
            {copied && <p role="status">迁移命令已复制</p>}
            <p>中断后先在本机执行回滚命令，再生成新迁移任务。回滚遇到后续配置修改时保留备份并停止，不覆盖修改。</p>
            <textarea aria-label="节点 API 地址回滚命令" readOnly rows={2} value={migration.rollbackCommand} />
        </>}
        {error && <p role="alert">{error}</p>}
    </details>;
}
