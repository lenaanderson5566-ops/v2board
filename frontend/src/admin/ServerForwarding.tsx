import { useMemo } from "react";
import type { Row } from "../shared/api";
import { Table } from "../shared/ui";

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

export function ServerForwarding({ server, data }: { server: Row; data: Row }) {
    const records = useMemo(
        () => serverForwardingRows(Number(server.id), data),
        [server.id, data],
    );
    return (
        <details className="admin-deployment-tools">
            <summary>本机入口转发（{records.length} 条）</summary>
            <p className="muted">
                在节点的接入配置中维护“入口域名、入口端口、代理服务”的关系；此处汇总本机已保存或仍在使用的线路。发布状态是面板记录，不能替代服务器实际连接测试。
            </p>
            <Table
                data={records}
                columns={[
                    ["name", "线路 / 服务"],
                    ["saved", "已保存入口"],
                    ["active", "当前发布路径"],
                    ["status", "状态"],
                ]}
            />
            {!records.length && (
                <p>
                    入口域名可以被多个服务复用。添加入口后，请在新增节点中选择“入口中转”，或复用已有代理服务配置中转线路；同台入口的监听端口不能重复。
                </p>
            )}
            <a href="#/node-forwarding">配置与发布转发线路</a>
            <p className="muted">
                Nginx 转发配置在中转服务器加载；V2Box
                一键部署命令在运行代理服务的服务器执行。只添加入口域名或配置 IP
                上报不会安装转发。
            </p>
        </details>
    );
}
