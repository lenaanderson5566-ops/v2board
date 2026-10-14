import { adminUserLabel } from "./admin-user-label";
import { System } from "./admin";
import { RiskOverview } from "./AdminRisk";
import { useState } from "react";
import { admin, money, type Row } from "../shared/api";
import { Panel, State, Table, Reload, useData } from "../shared/ui";

const colors = ["#1890ff", "#2fc25b", "#facc14", "#f04864", "#8543e0"];
export function Overview({
    initialTab = "income",
}: {
    initialTab?: "income" | "risk" | "system";
}) {
    const [tab, setTab] = useState(initialTab);
    return (
        <>
            <div
                className="section-tabs"
                role="tablist"
                aria-label="仪表盘视图"
            >
                <button
                    role="tab"
                    aria-selected={tab === "income"}
                    onClick={() => setTab("income")}
                >
                    经营概览
                </button>
                <button
                    role="tab"
                    aria-selected={tab === "risk"}
                    onClick={() => setTab("risk")}
                >
                    风控概览
                </button>
                <button
                    role="tab"
                    aria-selected={tab === "system"}
                    onClick={() => setTab("system")}
                >
                    系统监控
                </button>
            </div>
            {tab === "risk" ? (
                <RiskOverview />
            ) : tab === "system" ? (
                <System />
            ) : (
                <IncomeOverview />
            )}
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
                        loading={stat.loading || health.loading || orders.loading}
                        onClick={() => {
                            stat.reload();
                            health.reload();
                            orders.reload();
                        }}
                    />
                }
            >
                <State {...stat} retry={stat.reload}>
                    <div className="legacy-stat-main">
                        {[
                            ["在线人数", stats.online_user || 0],
                            ["今日收入", money(stats.day_income || 0)],
                            ["实时注册", stats.day_register_total || 0],
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
                            actions={<Reload onClick={d.reload} loading={d.loading} />}
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
    const [hidden, setHidden] = useState<string[]>([]);
    const types = [...new Set(data.map((r) => String(r.type)))];
    const dates = [...new Set(data.map((r) => String(r.date)))];
    const shown = data.filter((r) => !hidden.includes(String(r.type)));
    const maximum = Math.max(1, ...shown.map((r) => Number(r.value) || 0));
    return (
        <div className="legacy-chart legacy-history">
            <div className="chart-legend">
                {types.map((type, i) => (
                    <button
                        key={type}
                        aria-pressed={!hidden.includes(type)}
                        onClick={() =>
                            setHidden(
                                hidden.includes(type)
                                    ? hidden.filter((x) => x !== type)
                                    : [...hidden, type],
                            )
                        }
                    >
                        <i style={{ background: colors[i % colors.length] }} />
                        {type}
                    </button>
                ))}
            </div>
            <svg
                viewBox="0 0 1000 300"
                role="img"
                aria-label="近 31 天收入与注册趋势图"
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
                    .filter((t) => !hidden.includes(t))
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
