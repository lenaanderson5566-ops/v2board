import { useState } from "react";
import { admin, date, type Row } from "../shared/api";
import { ResourcePage } from "./admin";
import { Modal } from "../shared/ui";

const checks: Record<string, string> = {
    dns: "DNS",
    website: "网站",
    proxy: "本地代理",
    settings: "连接设置",
    systemProxy: "系统代理",
    route: "线路",
    tcp: "TCP",
    tls: "TLS",
    reference: "系统连接参考",
};
const statuses: Record<string, string> = {
    passed: "通过",
    failed: "失败",
    skipped: "跳过",
    unverified: "未验证",
};
const resource = {
    title: "客户端诊断",
    fetch: admin("client-diagnostics/fetch"),
    fields: [],
    create: false,
    serverSearch: true,
    columns: [
        ["report_id", "报告编号"],
        ["email", "用户"],
        ["client_version", "FastAI 版本"],
        ["platform", "系统"],
        [
            "checks",
            "失败检查",
            (r: Row) =>
                (r.checks || [])
                    .filter((c: Row) => c.status === "failed")
                    .map((c: Row) => checks[c.id] || c.id)
                    .join("、") || "无",
        ],
        ["created_at", "提交时间", (r: Row) => date(r.created_at)],
    ] as Parameters<typeof ResourcePage>[0]["resource"]["columns"],
};
export function AdminClientDiagnostics() {
    const [detail, setDetail] = useState<Row | null>(null);
    return (
        <>
            <ResourcePage
                resource={resource}
                toolbar={
                    <p className="pad muted">
                        用户手动提交的连接快照，可按邮箱、用户
                        ID、版本或报告编号检索。只含检查状态与耗时，不含访问记录、节点凭据或配置；不能据此断定故障根因。默认保留
                        30 天。
                    </p>
                }
                extraActions={(r) => (
                    <button onClick={() => setDetail(r)}>查看报告</button>
                )}
            />
            {detail && (
                <Modal title="客户端诊断报告" close={() => setDetail(null)}>
                    <p>
                        {detail.email} · FastAI {detail.client_version} ·{" "}
                        {detail.platform}
                    </p>
                    <p className="muted">
                        {detail.report_id} · {date(detail.created_at)}
                    </p>
                    <table>
                        <thead>
                            <tr>
                                <th>检查</th>
                                <th>结果</th>
                                <th>耗时</th>
                            </tr>
                        </thead>
                        <tbody>
                            {detail.checks.map((c: Row) => (
                                <tr key={c.id}>
                                    <td>{checks[c.id] || c.id}</td>
                                    <td>{statuses[c.status] || c.status}</td>
                                    <td>
                                        {c.elapsedMs == null
                                            ? "—"
                                            : `${c.elapsedMs} ms`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Modal>
            )}
        </>
    );
}
