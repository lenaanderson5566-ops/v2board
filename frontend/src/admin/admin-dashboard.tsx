import { AdminTabs } from "./AdminChoices";
import { adminUserLabel } from "./admin-user-label";
import { System } from "./admin";
import { RiskOverview } from "./AdminRisk";
import { useState } from "react";
import { admin, money, type Row } from "../shared/api";
import { Panel, State, Table, Reload, useData } from "../shared/ui";

function usageBytes(value: unknown) {
    let bytes = Math.max(0, Number(value) || 0);
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toLocaleString(undefined, {maximumFractionDigits: 2})} ${units[i]}`;
}
const colors = ["#1890ff", "#2fc25b", "#facc14", "#f04864", "#8543e0"];
export function Overview({
    initialTab = "income",
}: {
    initialTab?: "income" | "risk" | "system";
}) {
    const [tab, setTab] = useState(initialTab);
    return (
        <>
            <AdminTabs label="仪表盘视图" value={tab} onChange={setTab} options={[
                {value:"income",label:"经营概览"}, {value:"risk",label:"风控概览"}, {value:"system",label:"系统监控"}
            ]}>
            {tab === "risk" ? (
                <RiskOverview />
            ) : tab === "system" ? (
                <System />
            ) : (
                <IncomeOverview />
            )}
            </AdminTabs>
        </>
    );
}
function IncomeOverview() {
    const stat = useData<Row>(admin("stat/getOverride"));
    const health = useData<Row>(admin("system/getSystemStatus"));
    const orders = useData<Row[]>(admin("stat/getOrder"));
    const todayNodes = useData<Row[]>(admin("stat/getServerTodayRank"));
    const lastNodes = useData<Row[]>(admin("stat/getServerLastRank"));
    const todayUsers = useData<Row[]>(admin("stat/getUserTodayRank"));
    const lastUsers = useData<Row[]>(admin("stat/getUserLastRank"));
    const stats = stat.data || {};

    return (
        <>
            {health.data && (!health.data.horizon || !health.data.schedule) && (
                <div className="alert">
                    <a href="#/system">队列或定时任务异常，查看系统状态</a>
                </div>
            )}
            {Number(stats.ticket_pending_total) > 0 && (
                <div className="alert">
                    有 {stats.ticket_pending_total} 条工单等待处理{" "}
                    <a href="#/tickets?status=0&reply_status=0">立即处理</a>
                </div>
            )}
            {Number(stats.commission_pending_total) > 0 && (
                <div className="alert">
                    有 {stats.commission_pending_total} 条佣金等待审核{" "}
                    <a href="#/invitations?tab=commissions">立即处理</a>
                </div>
            )}
            <Panel
                actions={
                    <Reload
                        loading={[stat, health, orders, todayNodes, lastNodes, todayUsers, lastUsers].some((source) => source.loading)}
                        onClick={() => {
                            [stat, health, orders, todayNodes, lastNodes, todayUsers, lastUsers].forEach((source) => source.reload());
                        }}
                    />
                }
            >
                <State {...stat} retry={stat.reload}>
                    <div className="legacy-stat-main">
                        {[
                            ["近 10 分钟活跃用户", stats.online_user ?? "—"],
                            ["今日收入", money(stats.day_income || 0)],
                            ["今日新增用户", stats.day_register_total ?? "—"],
                        ].map(([label, value]) => (
                            <div key={String(label)}>
                                <span>{label}</span>
                                <strong>{value}</strong>
                            </div>
                        ))}
                    </div>
                    <div className="legacy-stat-extra">
                        {[
                            ["本月收入", money(stats.month_income || 0)],
                            ["上月收入", money(stats.last_month_income || 0)],
                            ["本年度收入", money(stats.year_income || 0)],
                            ["上年度收入", money(stats.last_year_income || 0)],
                            [
                                "上年度同期收入",
                                money(stats.last_year_same_period_income || 0),
                            ],
                            ["本月新增用户", stats.month_register_total || 0],
                        ].map(([label, value]) => (
                            <div key={String(label)}>
                                {value}
                                <span>{label}</span>
                            </div>
                        ))}
                    </div>
                </State>
                <p className="pad muted">
                    收入按实际支付时间统计（CNY）；上年度同期为去年年初至去年同月同日同一时刻，闰日按
                    2 月末计算。
                </p>
                <State {...orders} retry={orders.reload}>
                    <HistoryChart
                        data={(orders.data || []).filter(
                            (r) => !String(r.type).includes("佣金"),
                        )}
                    />
                </State>
            </Panel>
            <Panel title="用户活跃与流量">
                <State {...stat} retry={stat.reload}>
                    {stats.usage ? <>
                        <div className="dashboard-usage-grid">
                            {(stats.usage.periods as Row[]).map(period => <article key={period.days} className="dashboard-usage-card">
                                <span>{period.days === 1 ? "今日" : `近 ${period.days} 天`}</span>
                                <div><strong>{Number(period.users).toLocaleString()}</strong><span>活跃用户</span></div>
                                <div><strong>{usageBytes(period.bytes)}</strong><span>实际使用流量</span></div>
                            </article>)}
                        </div>
                        <p className="pad muted">按 {stats.usage.timezone} 自然日统计，近 7 / 30 天均包含今日；有节点上报流量才算活跃，同一用户跨设备、节点及日期去重。流量为上传＋下载，不乘计费倍率。最多缓存 2 分钟，另有节点上报和队列延迟。</p>
                        {!stats.usage.has_records && <p className="pad muted">近 30 天尚无流量记录；零值仅表示未记录到使用，不能证明历史采集完整。</p>}
                        <div className="pad actions"><span>每日流量趋势</span><span className="muted">单位：GiB · 今日尚未结束 · 没有记录的日期不补零</span></div>
                        <HistoryChart data={(stats.usage.daily as Row[]).map(r=>({type:"实际流量（GiB）",date:r.date,value:Number(r.bytes)/1073741824}))}/>
                    </> : <p className="pad muted">暂无活跃与流量统计，请确认后端已更新。</p>}
                </State>
            </Panel>
            <div className="legacy-ranks">
                {[
                    ["今日节点流量排行", todayNodes, "server_name"],
                    ["昨日节点流量排行", lastNodes, "server_name"],
                    ["今日用户流量排行", todayUsers, "email"],
                    ["昨日用户流量排行", lastUsers, "email"],
                ].map(([title, result, key]) => {
                    const d = result as typeof todayNodes;
                    return (
                        <Panel
                            key={String(title)}
                            title={String(title)}
                        >
                            <State {...d} retry={d.reload}>
                                <RankChart
                                    data={d.data || []}
                                    nameKey={String(key)}
                                />
                                <details className="pad">
                                    <summary>查看排行数据</summary>
                                    <Table
                                        data={d.data || []}
                                        columns={[
                                            [
                                                String(key),
                                                key === "email"
                                                    ? "用户（ID / 邮箱）"
                                                    : "节点",
                                                (r) =>
                                                    key === "email"
                                                        ? adminUserLabel(r)
                                                        : r[String(key)],
                                            ],
                                            [
                                                "total",
                                                "流量（GB）",
                                                (r) =>
                                                    Number(r.total).toFixed(2),
                                            ],
                                        ]}
                                        actions={
                                            key === "email"
                                                ? (r) => (
                                                      <a
                                                          className="button"
                                                          href={`#/users?user_id=${r.user_id}`}
                                                      >
                                                          查看用户
                                                      </a>
                                                  )
                                                : undefined
                                        }
                                    />
                                </details>
                            </State>
                        </Panel>
                    );
                })}
            </div>
        </>
    );
}

export function RankChart({ data, nameKey }: { data: Row[]; nameKey: string }) {
    const maximum = Math.max(1, ...data.map((r) => Number(r.total) || 0));
    return (
        <div
            className="dashboard-rank"
            role="img"
            aria-label="流量排行横向柱状图"
        >
            {!data.length && <p className="muted">暂无数据</p>}
            {data.map((r, i) => {
                const name =
                    nameKey === "email"
                        ? adminUserLabel(r)
                        : String(r[nameKey] || "未知节点");
                const value = Math.max(0, Number(r.total) || 0);
                return (
                    <div
                        className="dashboard-rank-row"
                        key={`${r.server_type || "user"}-${r.server_id || r.user_id || i}`}
                    >
                        <div className="dashboard-rank-label">
                            <span title={name}>{name}</span>
                            <strong>{value.toFixed(2)} GB</strong>
                        </div>
                        <div className="dashboard-rank-track">
                            <div
                                style={{ width: `${(value / maximum) * 100}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function HistoryChart({ data }: { data: Row[] }) {
    const [selected, setSelected] = useState("");
    const types = [...new Set(data.map((r) => String(r.type)))];
    const dates = [...new Set(data.map((r) => String(r.date)))];
    const active = types.includes(selected) ? selected : types[0];
    const shown = data.filter((r) => String(r.type) === active);
    const maximum = Math.max(1, ...shown.map((r) => Number(r.value) || 0));
    return (
        <div className="legacy-chart legacy-history">
            <div className="chart-legend">
                {types.map((type, i) => (
                    <button
                        key={type}
                        aria-pressed={active === type}
                        onClick={() => setSelected(type)}
                    >
                        <i style={{ background: colors[i % colors.length] }} />
                        {type}
                    </button>
                ))}
            </div>
            <svg
                viewBox="0 0 1000 300"
                role="img"
                aria-label={`每日趋势：${types.join("、")}`}
            >
                {[0, 1, 2, 3, 4].map((i) => (
                    <g key={i}>
                        <line
                            x1="55"
                            y1={250 - i * 55}
                            x2="970"
                            y2={250 - i * 55}
                            stroke="#e8e8e8"
                        />
                        <text
                            x="48"
                            y={254 - i * 55}
                            textAnchor="end"
                            fill="#8c8c8c"
                            fontSize="12"
                        >
                            {((maximum * i) / 4).toFixed(1)}
                        </text>
                    </g>
                ))}
                {dates.map(
                    (day, i) =>
                        i % Math.max(1, Math.ceil(dates.length / 10)) === 0 && (
                            <text
                                key={day}
                                x={
                                    65 +
                                    (i * 900) / Math.max(1, dates.length - 1)
                                }
                                y="280"
                                textAnchor="middle"
                                fill="#8c8c8c"
                                fontSize="12"
                            >
                                {day}
                            </text>
                        ),
                )}
                {types
                    .filter((t) => t === active)
                    .map((type) => {
                        const color =
                            colors[types.indexOf(type) % colors.length];
                        const points = dates.map((date, i) => ({
                            x: 65 + (i * 900) / Math.max(1, dates.length - 1),
                            value: Number(
                                data.find(
                                    (r) => r.type === type && r.date === date,
                                )?.value || 0,
                            ),
                        }));
                        return (
                            <g key={type}>
                                <polyline
                                    points={points
                                        .map(
                                            (p) =>
                                                `${p.x},${250 - (p.value / maximum) * 220}`,
                                        )
                                        .join(" ")}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth="2"
                                />
                                {points.map((p, i) => (
                                    <circle
                                        key={i}
                                        cx={p.x}
                                        cy={250 - (p.value / maximum) * 220}
                                        r="4"
                                        fill={color}
                                    >
                                        <title>
                                            {dates[i]} · {type}：{p.value}
                                        </title>
                                    </circle>
                                ))}
                            </g>
                        );
                    })}
                {!data.length && (
                    <text x="500" y="140" textAnchor="middle" fill="#bfbfbf">
                        暂无运营记录
                    </text>
                )}
            </svg>
        </div>
    );
}
