import { bytes, type Row } from "../shared/api";
export function RiskEvidence({ payload: p = {} }: { payload?: Row }) {
    const window = p.window_seconds == null ? "统计窗口未知" : Number(p.window_seconds) % 3600 === 0 ? `${Number(p.window_seconds) / 3600} 小时内` : `${Number(p.window_seconds) / 60} 分钟内`;
    return <div className="risk-rule-card">
        {p.request_count != null && <p>{window}拉取 {p.request_count} 次，阈值 ≥ {p.threshold ?? "未知"} 次。</p>}
        {p.subscribe_count != null && <p>{window}成功拉取 {p.subscribe_count} 次，阈值 ≥ {p.subscribe_threshold ?? "未知"} 次。</p>}
        {p.traffic_growth_bytes != null && <p>流量增长 {bytes(p.traffic_growth_bytes)}，命中上限 ≤ {p.traffic_growth_threshold_bytes == null ? "未知" : bytes(p.traffic_growth_threshold_bytes)}。</p>}
        {p.distinct_client_type_count != null && <p>{window}出现 {p.distinct_client_type_count} 种客户端，阈值 ≥ {p.threshold ?? "未知"} 种。</p>}
        {p.ua_hash && <p style={{ overflowWrap: "anywhere" }}>完整 UA 哈希命中黑名单：{p.ua_hash}</p>}
        <p className="muted">这是命中时的统计快照，不代表已封禁。缺失的数据不按零处理。</p>
    </div>;
}
