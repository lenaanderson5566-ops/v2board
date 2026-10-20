import { useState } from "react";
import { admin, bytes, query, request, type Row } from "../shared/api";
import { Panel, State, Table, Pager, useData } from "../shared/ui";
import { AdminFilterBar } from "./AdminFilterBar";
import { AdminSwitch } from "./admin-switch";

export function TargetStatisticsSettings() {
    const data = useData<Row>(admin("target-statistics"));
    const [saved, setSaved] = useState<boolean | null>(null);
    return (
        <Panel padded title="节点访问目标统计">
            <State {...data} retry={data.reload}>
                {data.data?.settings && (
                    <label className="actions">
                        <span>统计用户访问的域名和 IP</span>
                        <AdminSwitch
                            label="统计用户访问的域名和 IP"
                            checked={saved ?? data.data.settings.enabled}
                            onChange={async (enabled) => {
                                const result = await request(
                                    admin("target-statistics/settings"),
                                    { enabled },
                                );
                                setSaved(result.data.enabled);
                                data.reload();
                            }}
                        />
                    </label>
                )}
            </State>
            <p className="muted">默认关闭，仅支持新版 V2Box。保留最近 1 小时的域名、IP 与流量，不记录网址路径、内容或来源 IP。</p>
            <p className="muted">关闭后立即停止接收，节点下次同步停采；授权最多 120 秒。重新开启后重新累计，不影响计费。</p>
            <a href="#/analytics">查看访问与转化中的“节点访问目标”</a>
        </Panel>
    );
}

export function AdminTargetStatistics() {
    const [nodeId, setNode] = useState(0),
        [userId, setUser] = useState(""),
        [userDraft, setUserDraft] = useState(""),
        [page, setPage] = useState(1);
    const report = useData<Row>(
        query(admin("target-statistics"), {
            nodeId,
            userId: Number(userId) || 0,
            page,
        }),
    );
    const data = report.data;
    return (
        <Panel
            padded
            title="节点访问目标 · 最近 1 小时"
            actions={
                <button onClick={report.reload} disabled={report.loading}>
                    刷新统计
                </button>
            }
        >
            <p className="muted">按原始域名或 IP 统计，不反向解析或替换嗅探名称。每 5 分钟汇总；连接数不等于网页访问次数。</p>
            <AdminFilterBar aria-label="访问目标筛选" onSubmit={event => {event.preventDefault();setUser(userDraft);setPage(1);}}>
                <label>
                    节点
                    <select
                        aria-label="访问目标节点"
                        value={nodeId}
                        onChange={(e) => {
                            setNode(Number(e.target.value));
                            setPage(1);
                        }}
                    >
                        <option value={0}>选择 V2Box 节点</option>
                        {(data?.nodes || []).map((node: Row) => (
                            <option key={node.id} value={node.id}>
                                {node.name}
                                {node.supported ? "" : "（未报告统计能力）"}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    用户 ID
                    <input
                        aria-label="访问目标用户 ID"
                        type="number"
                        min={1}
                        value={userDraft}
                        placeholder="全部用户"
                        onChange={(e) => {
                            setUserDraft(e.target.value);
                        }}
                    />
                </label>
                <div className="admin-filter-actions"><button type="submit" className="primary" disabled={report.loading}>查询</button><button type="button" disabled={report.loading} onClick={()=>{setNode(0);setUser("");setUserDraft("");setPage(1);}}>重置</button><a href="#/log-settings">管理统计开关</a></div>
            </AdminFilterBar>
            <State {...report} retry={report.reload}>
                {data?.settings && (
                    <>
                        {!data.settings.enabled && (
                            <p role="status">访问目标统计未开启。</p>
                        )}
                        {data.settings.enabled && !nodeId && (
                            <p>请选择节点查看统计。</p>
                        )}
                        {data.dropped > 0 && (
                            <p role="status">
                                容量限制触发 {data.dropped}{" "}
                                次丢弃，以下数据不完整。
                            </p>
                        )}
                        <Table
                            data={data.rows || []}
                            columns={[
                                ["userId", "用户 ID"],
                                [
                                    "type",
                                    "类型",
                                    (r) => (r.type === "ip" ? "IP" : "域名"),
                                ],
                                ["target", "访问目标"],
                                ["connections", "连接数"],
                                [
                                    "uploadBytes",
                                    "上传",
                                    (r) => bytes(r.uploadBytes),
                                ],
                                [
                                    "downloadBytes",
                                    "下载",
                                    (r) => bytes(r.downloadBytes),
                                ],
                            ]}
                        />
                        <Pager page={page} total={data.total || 0} size={25} loading={report.loading} onChange={setPage} />
                    </>
                )}
            </State>
            <p className="muted">
                重启、缓存丢失、采集容量限制或网络故障可能造成缺失。此报表不用于计费，也不能补算历史访问。
            </p>
        </Panel>
    );
}
