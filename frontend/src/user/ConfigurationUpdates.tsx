import { useState } from "react";
import { ArrowLeft, History } from "lucide-react";
import type { V10SubscriptionAccessRecord } from "../shared/v10-types";
import { tx } from "../shared/i18n";
import { formatInstant } from "../shared/timezone";
import { State, useData } from "../shared/ui/data";
import { Pager, Reload } from "../shared/ui/controls";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { SettingsHeading } from "./SettingsHeading";
import "./configuration-updates.css";

const pageSize = 20;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const failureExplanations = new Map([
    ["expired", "此次请求时订阅已到期，请检查有效期或续费后更新配置。"],
    ["no_plan", "此次请求时没有可用订阅，请检查套餐状态。"],
    ["banned", "此次请求时账户不可用，请联系支持核实账户状态。"],
    ["user_unavailable", "此次请求时账户不可用，请联系支持核实账户状态。"],
    ["client_version_too_low", "此次请求的客户端版本过旧，请更新客户端后重新获取配置。"],
    ["client_disabled", "此次请求使用的客户端暂不可用，请在配置中心选择其他客户端。"],
    ["client_ua_not_allowed", "此次请求的客户端不受支持，请在配置中心选择受支持的客户端。"],
    ["client_format_not_allowed", "此次请求的配置类型不受支持，请在配置中心重新选择客户端并导入。"],
]);

function RequestResult({ record }: { record: V10SubscriptionAccessRecord }) {
    const status = record.status === "success" ? "success" : record.status === "failed" ? "failed" : "unknown";
    const label = status === "success" ? "请求成功" : status === "failed" ? "请求未成功" : "结果未知";
    const explanation = status === "failed" ? failureExplanations.get(text(record.reason)) : undefined;
    return <>
        <span className={`configuration-request-status ${status}`}>{tx(label)}</span>
        {explanation && <small className="configuration-request-reason">{tx(explanation)}</small>}
    </>;
}

export function ConfigurationUpdates() {
    const [page, setPage] = useState(1);
    const records = useData<V10SubscriptionAccessRecord[]>(
        `user/subscription/access-records?page=${page}&pageSize=${pageSize}`,
        undefined, false, { refreshOnEvents: false },
    );
    const retryIn = useRetryCountdown(records.retryAt);
    const blocked = records.loading || retryIn > 0;
    const rows = Array.isArray(records.data) ? records.data.filter(record => record && typeof record === "object" && !Array.isArray(record)) : [];
    const retentionDays = records.meta?.retentionDays;
    const pagination = records.meta?.pagination;
    return <section className="settings-content configuration-updates">
        <a className="configuration-updates-back" href="#/security"><ArrowLeft size={16} aria-hidden="true" />{tx("返回账户安全")}</a>
        <SettingsHeading icon={<History size={24} />} title={tx("配置更新记录")}
            description={tx("记录客户端获取或更新配置的请求，不代表导入或连接成功。")} />
        <div className="settings-card">
            <header className="configuration-updates-toolbar">
                <div className="muted">
                    <p>{Number.isInteger(retentionDays) && retentionDays > 0
                        ? tx("仅显示最近 {{days}} 天内保留的记录。", { days: retentionDays })
                        : tx("仅显示当前保留范围内的记录。")}</p>
                    <p>{tx("时间按您的显示时区展示。")}</p>
                </div>
                <Reload onClick={records.reload} loading={records.loading} disabled={blocked} />
            </header>
            <State {...records} retry={records.reload}>
                {rows.length ? <table className="configuration-updates-table">
                    <caption className="sr-only">{tx("配置更新记录")}</caption>
                    <thead><tr>
                        {["请求时间", "客户端", "请求结果", "来源 IP 与地区"].map(label => <th key={label} scope="col">{tx(label)}</th>)}
                    </tr></thead>
                    <tbody>{rows.map((record, index) => {
                        const requestedAt = text(record.requestedAt);
                        const validTime = requestedAt && Number.isFinite(Date.parse(requestedAt));
                        const clientName = text(record.clientName) || tx("客户端未识别");
                        const version = text(record.clientVersion);
                        const ip = text(record.ip);
                        const location = text(record.location);
                        return <tr key={record.id ?? index}>
                            <td data-label={tx("请求时间")}><time dateTime={validTime ? requestedAt : undefined}>{validTime ? formatInstant(requestedAt) : "—"}</time></td>
                            <td data-label={tx("客户端")}><strong>{clientName}</strong>{version && <small><bdi>{version}</bdi></small>}</td>
                            <td data-label={tx("请求结果")}><RequestResult record={record} /></td>
                            <td data-label={tx("来源 IP 与地区")}><bdi dir="ltr">{ip || tx("来源未知")}</bdi>{location && <small>{location}</small>}</td>
                        </tr>;
                    })}</tbody>
                </table> : <p className="configuration-updates-empty">{tx("保留范围内暂无配置更新记录。")}</p>}
            </State>
            {pagination && pagination.total > 0 ? <Pager page={page} total={pagination.total} size={pageSize} loading={blocked} onChange={setPage} />
                : page > 1 && !records.loading && <div className="configuration-updates-recovery"><button type="button" disabled={blocked} onClick={() => setPage(page - 1)}>{tx("上一页")}</button></div>}
            <p className="muted configuration-updates-location">{tx("位置根据请求 IP 估算，可能显示代理出口所在地。")}</p>
        </div>
    </section>;
}
