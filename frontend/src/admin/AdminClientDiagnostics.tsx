import { TableViewport } from "../shared/ui";
import { useState } from "react";
import { admin, date, type Row } from "../shared/api";
import { ResourcePage } from "./admin";
import { Modal } from "../shared/ui";

const checks: Record<string, string> = {
    connection: "连接",
    config_sync: "配置同步",
    subscription_sync: "订阅同步",
    account_sync: "账号同步",
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
const errorClasses: Record<string, string> = {
    none: "无",
    timeout: "超时",
    network: "网络",
    certificate: "证书",
    authentication: "认证",
    policy: "策略",
    server: "服务端",
    unknown: "未分类",
};
const statuses: Record<string, string> = {
    success: "成功",
    failure: "失败",
    passed: "通过",
    failed: "失败",
    skipped: "跳过",
    unverified: "未验证",
};
const resource = {
    title: "客户端运行记录",
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
            "report_kind",
            "来源",
            (r: Row) => (r.report_kind === "runtime" ? "运行事件" : "旧版诊断"),
        ],
        [
            "checks",
            "失败事件",
            (r: Row) =>
                (r.checks || [])
                    .filter(
                        (c: Row) =>
                            c.status === "failed" || c.outcome === "failure",
                    )
                    .map((c: Row) => checks[c.name || c.id] || c.name || c.id)
                    .join("、") || "无",
        ],
        ["created_at", "提交时间", (r: Row) => date(r.created_at)],
    ] as Parameters<typeof ResourcePage>[0]["resource"]["columns"],
};
export function AdminClientDiagnostics() {
    const [kind, setKind] = useState("runtime");
    const [detail, setDetail] = useState<Row | null>(null);
    return (
        <>
            <ResourcePage
                key={kind}
                resource={resource}
                queryParams={kind ? { kind } : {}}
                toolbar={
                    <div className="pad">
                        <p className="muted">
                            用户自愿共享的运行事件，按邮箱、用户
                            ID、版本或报告编号检索。记录连接与同步结果、错误类别和耗时，默认保留
                            30
                            天。未开启共享或尚无数据不代表用户离线；数据来自客户端自报。
                        </p>
                        <select
                            aria-label="记录来源"
                            value={kind}
                            onChange={(e) => setKind(e.target.value)}
                        >
                            <option value="runtime">运行事件</option>
                            <option value="diagnostic">旧版诊断</option>
                            <option value="">全部</option>
                        </select>
                    </div>
                }
                extraActions={(r) => (
                    <button onClick={() => setDetail(r)}>查看报告</button>
                )}
            />
            {detail && (
                <Modal title="客户端运行记录" close={() => setDetail(null)}>
                    <p>
                        {detail.email} · FastAI {detail.client_version} ·{" "}
                        {detail.platform}
                    </p>
                    <p className="muted">
                        {detail.report_id} · {date(detail.created_at)}
                    </p>
                    <TableViewport><table>
                        <thead>
                            <tr>
                                <th>事件</th>
                                <th>错误类别</th>
                                <th>结果</th>
                                <th>耗时</th>
                            </tr>
                        </thead>
                        <tbody>
                            {detail.checks.map((c: Row, index: number) => (
                                <tr key={index}>
                                    <td>
                                        {checks[c.name || c.id] ||
                                            c.name ||
                                            c.id}
                                    </td>
                                    <td>{errorClasses[c.errorClass] || "—"}</td>
                                    <td>
                                        {statuses[c.outcome || c.status] ||
                                            c.outcome ||
                                            c.status}
                                    </td>
                                    <td>
                                        {c.elapsedMs == null
                                            ? "—"
                                            : `${c.elapsedMs} ms`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table></TableViewport>
                </Modal>
            )}
        </>
    );
}
