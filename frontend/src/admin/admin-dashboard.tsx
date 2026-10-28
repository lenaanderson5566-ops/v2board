import "./admin-dashboard.css";
import { AdminChoiceGroup, AdminTabs } from "./AdminChoices";
import { adminUserLabel } from "./admin-user-label";
import { System } from "./admin";
import { RiskOverview } from "./AdminRisk";
import { lazy, Suspense, useEffect, useState } from "react";
const AdminAnalytics = lazy(() =>
    import("./AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })),
);
import { admin, type Row } from "../shared/api";
import { Panel, State, Table, Reload, Metric, useData } from "../shared/ui";

function usageBytes(value: unknown) {
    let bytes = Math.max(0, Number(value) || 0);
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[i]}`;
}
export function Overview({
    initialTab = "income",
}: {
    initialTab?: "income" | "analytics" | "risk" | "system";
}) {
    const [tab, setTab] = useState(initialTab);
    useEffect(() => setTab(initialTab), [initialTab]);
    return (
        <div className="dashboard-workspace">
            <AdminTabs
                label="仪表盘视图"
                value={tab}
                onChange={(next) => {
                    setTab(next);
                    window.location.hash =
                        next === "income" ? "/overview" : `/overview-${next}`;
                }}
                options={[
                    { value: "income", label: "经营概览" },
                    { value: "analytics", label: "访问与转化" },
                    { value: "risk", label: "风控概览" },
                    { value: "system", label: "系统监控" },
                ]}
            >
                {tab === "analytics" ? (
                    <Suspense
                        fallback={
                            <p className="pad" role="status">
                                正在加载访问报表…
                            </p>
                        }
                    >
                        <AdminAnalytics />
                    </Suspense>
                ) : tab === "risk" ? (
                    <RiskOverview />
                ) : tab === "system" ? (
                    <System />
                ) : (
                    <IncomeOverview />
                )}
            </AdminTabs>
        </div>
    );
}
function IncomeOverview() {
    const stat = useData<Row>(admin("stat/getOverride"));
    const health = useData<Row>(admin("system/getSystemStatus"));
    const [currency, setCurrency] = useState("CNY");
    const [trend, setTrend] = useState("amount");
    const [days, setDays] = useState("30");
    const todayNodes = useData<Row[]>(admin("stat/getServerTodayRank"));
    const todayUsers = useData<Row[]>(admin("stat/getUserTodayRank"));
    const stats = stat.data || {};
    const finance = (stats.financial?.currencies || []).find(
        (row: Row) => row.currency === currency,
    );
    const amount = (value: unknown) =>
        value == null
            ? "—"
            : `${currency} ${(Number(value) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <>
            <div className="dashboard-toolbar">
                <div>
                    <strong>经营概览</strong>
                    <p className="muted">
                        先处理待办，再查看经营与使用趋势。今日数据仍在累计。
                    </p>
                </div>
                <Reload
                    loading={[stat, health, todayNodes, todayUsers].some(
                        (source) => source.loading,
                    )}
                    onClick={() => {
                        [stat, health, todayNodes, todayUsers].forEach(
                            (source) => source.reload(),
                        );
                    }}
                />
            </div>
            {health.error ? (
                <div className="alert" role="alert">
                    系统状态暂时无法确认，请刷新重试。{" "}
                    <a href="#/overview-system">查看系统监控</a>
                </div>
            ) : (
                !health.loading &&
                health.data &&
                (!health.data.horizon || !health.data.schedule) && (
                    <div className="alert" role="alert">
                        <a href="#/overview-system">
                            队列或定时任务异常，查看系统状态
                        </a>
                    </div>
                )
            )}
            <div className="dashboard-todos" aria-label="待处理事项">
                {!stat.error && Number(stats.ticket_pending_total) > 0 && (
                    <div className="alert">
                        有 {stats.ticket_pending_total} 条工单等待处理{" "}
                        <a href="#/tickets?status=0&reply_status=0">立即处理</a>
                    </div>
                )}
                {!stat.error && Number(stats.commission_pending_total) > 0 && (
                    <div className="alert">
                        有 {stats.commission_pending_total} 条佣金等待审核{" "}
                        <a href="#/invitations?tab=commissions">立即处理</a>
                    </div>
                )}
            </div>
            <Panel
                title="经营核心指标"
                actions={
                    <label className="actions">
                        统计币种{" "}
                        <select
                            aria-label="经营统计币种"
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                        >
                            <option>CNY</option>
                            <option>USD</option>
                        </select>
                    </label>
                }
            >
                <State {...stat} retry={stat.reload}>
                    <div className="dashboard-core-metrics dashboard-finance-metrics">
                        {[
                            [
                                "今日已支付订单金额",
                                amount(finance?.today_amount),
                            ],
                            [
                                "本月已支付订单金额",
                                amount(finance?.month_amount),
                            ],
                            [
                                "上月已支付订单金额",
                                amount(finance?.previous_amount),
                            ],
                            ["本月已支付订单", finance?.month_count ?? "—"],
                            ["平均支付金额", amount(finance?.average_amount)],
                            [
                                "较上月同期",
                                finance?.change_percent == null
                                    ? "—"
                                    : `${finance.change_percent > 0 ? "+" : ""}${finance.change_percent}%`,
                            ],
                        ].map(([label, value]) => (
                            <Metric
                                key={String(label)}
                                label={String(label)}
                                value={value}
                            />
                        ))}
                    </div>
                    <details className="dashboard-definition">
                        <summary>统计口径与更新延迟</summary>
                        <p className="muted">
                            按支付时间与订单币种统计（
                            {stats.financial?.timeZone || "系统时区"}
                            ），最多缓存 60
                            秒。金额为余额抵扣后的订单应付金额，不是渠道结算或净利润；零元订单计入笔数。上月同期按相同日期和时刻比较，月末按上月最后一天截断。
                        </p>
                    </details>
                    {finance && (
                        <>
                            <h3 className="pad">业务构成与佣金</h3>
                            <div className="dashboard-core-metrics">
                                {[
                                    [
                                        "本月订阅订单金额",
                                        amount(finance.subscription_amount),
                                    ],
                                    [
                                        "本月充值订单金额",
                                        amount(finance.deposit_amount),
                                    ],
                                    [
                                        "本月已发放佣金",
                                        amount(finance.commission_paid),
                                    ],
                                    [
                                        "待审核佣金",
                                        amount(finance.commission_pending),
                                    ],
                                ].map(([label, value]) => (
                                    <Metric
                                        key={label}
                                        label={label}
                                        value={value}
                                    />
                                ))}
                            </div>
                            <p className="pad muted">
                                充值与订阅金额分别展示，不将充值到账后使用的余额再次计入收款。待审核佣金{" "}
                                {finance.commission_pending_count} 笔。
                            </p>
                            <div className="dashboard-trend-toolbar">
                                <h3>支付趋势</h3>
                                <AdminChoiceGroup
                                    label="支付趋势指标"
                                    value={trend}
                                    onChange={setTrend}
                                    options={[
                                        { value: "amount", label: "订单金额" },
                                        { value: "count", label: "订单笔数" },
                                    ]}
                                />
                                <AdminChoiceGroup
                                    label="支付趋势范围"
                                    value={days}
                                    onChange={setDays}
                                    options={[
                                        { value: "7", label: "近 7 天" },
                                        { value: "30", label: "近 30 天" },
                                    ]}
                                />
                            </div>
                            <HistoryChart
                                data={(finance.daily || [])
                                    .slice(-Number(days))
                                    .map((r: Row) => ({
                                        date: r.date,
                                        value:
                                            trend === "amount"
                                                ? r.amount / 100
                                                : r.count,
                                    }))}
                                label={
                                    trend === "amount"
                                        ? `订单金额（${currency}）`
                                        : "支付订单笔数"
                                }
                                integer={trend === "count"}
                            />
                        </>
                    )}
                </State>
            </Panel>
            <Panel title="用户活跃与流量">
                <State {...stat} retry={stat.reload}>
                    <div className="dashboard-core-metrics">
                        {[
                            ["近 10 分钟活跃用户", stats.online_user ?? "—"],
                            ["今日新增用户", stats.day_register_total ?? "—"],
                            ["本月新增用户", stats.month_register_total ?? "—"],
                        ].map(([label, value]) => (
                            <Metric
                                key={String(label)}
                                label={String(label)}
                                value={value}
                            />
                        ))}
                    </div>
                    {stats.usage ? (
                        <>
                            <div className="dashboard-usage-grid">
                                {(stats.usage.periods as Row[]).map(
                                    (period) => (
                                        <article
                                            key={period.days}
                                            className="dashboard-usage-card"
                                        >
                                            <span>
                                                {period.days === 1
                                                    ? "今日"
                                                    : `近 ${period.days} 天`}
                                            </span>
                                            <div>
                                                <strong>
                                                    {Number(
                                                        period.users,
                                                    ).toLocaleString()}
                                                </strong>
                                                <span>活跃用户</span>
                                            </div>
                                            <div>
                                                <strong>
                                                    {usageBytes(period.bytes)}
                                                </strong>
                                                <span>实际使用流量</span>
                                            </div>
                                        </article>
                                    ),
                                )}
                            </div>
                            <p className="pad muted">
                                按 {stats.usage.timezone} 自然日统计，近 7 / 30
                                天均包含今日；有节点上报流量才算活跃，同一用户跨设备、节点及日期去重。流量为上传＋下载，不乘计费倍率。最多缓存
                                2 分钟，另有节点上报和队列延迟。
                            </p>
                            {!stats.usage.has_records && (
                                <p className="pad muted">
                                    近 30
                                    天尚无流量记录；零值仅表示未记录到使用，不能证明历史采集完整。
                                </p>
                            )}
                            <div className="pad actions">
                                <span>每日流量趋势</span>
                                <span className="muted">
                                    单位：GiB · 今日尚未结束 ·
                                    没有记录的日期不补零
                                </span>
                            </div>
                            <HistoryChart
                                label="实际流量（GiB）"
                                data={(stats.usage.daily as Row[]).map((r) => ({
                                    type: "实际流量（GiB）",
                                    date: r.date,
                                    value: Number(r.bytes) / 1073741824,
                                }))}
                            />
                        </>
                    ) : (
                        <p className="pad muted">
                            暂无活跃与流量统计，请确认后端已更新。
                        </p>
                    )}
                </State>
            </Panel>
            <div className="legacy-ranks">
                {[
                    ["今日节点流量排行", todayNodes, "server_name"],
                    ["今日用户流量排行", todayUsers, "email"],
                ].map(([title, result, key]) => {
                    const d = result as typeof todayNodes;
                    return (
                        <Panel key={String(title)} title={String(title)}>
                            <p className="dashboard-rank-note muted">
                                {key === "email"
                                    ? "按计费流量排序（含节点倍率）"
                                    : "按实际上传＋下载流量排序"}{" "}
                                · 前 15 名 · 单位 GiB
                            </p>
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
                                                key === "email"
                                                    ? "计费流量（GiB）"
                                                    : "实际流量（GiB）",
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
            role="group"
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
                            <span title={name}>
                                {i + 1}. {name}
                            </span>
                            <strong>{value.toFixed(2)} GiB</strong>
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

export function HistoryChart({
    data,
    label,
    integer = false,
}: {
    data: Row[];
    label: string;
    integer?: boolean;
}) {
    const [selected, setSelected] = useState("");
    const dayMs = 86400000;
    const points = data
        .map((row) => ({
            date: String(row.date),
            value: row.value == null ? NaN : Number(row.value),
            time: Date.parse(`${row.date}T00:00:00Z`),
        }))
        .filter(
            (row) =>
                /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
                Number.isFinite(row.time),
        )
        .sort((a, b) => a.time - b.time);
    const valid = points.filter(
        (row) => Number.isFinite(row.value) && row.value >= 0,
    );
    const maximum = integer
        ? Math.max(
              4,
              Math.ceil(Math.max(0, ...valid.map((row) => row.value)) / 4) * 4,
          )
        : Math.max(0.01, ...valid.map((row) => row.value));
    const first = points[0]?.time || 0,
        last = points.at(-1)?.time || first;
    const x = (time: number) =>
        first === last ? 515 : 75 + ((time - first) / (last - first)) * 890;
    const y = (value: number) => 230 - (value / maximum) * 190;
    const format = (value: number) =>
        value.toLocaleString(undefined, {
            minimumFractionDigits: integer ? 0 : 2,
            maximumFractionDigits: integer ? 0 : 2,
        });
    const active = valid.find((row) => row.date === selected) || valid.at(-1);
    const segments: (typeof valid)[] = [];
    for (const point of valid) {
        const segment = segments.at(-1);
        if (!segment || point.time - segment.at(-1)!.time !== dayMs)
            segments.push([point]);
        else segment.push(point);
    }
    return (
        <figure className="dashboard-history" aria-label={label}>
            <figcaption>
                <strong>{label}</strong>
                <span className="muted">
                    {active
                        ? `${active.date} · ${format(active.value)}`
                        : "暂无运营记录"}
                </span>
            </figcaption>
            {valid.length > 0 && (
                <>
                    <div className="dashboard-chart-scroll">
                        <svg
                            viewBox="0 0 1000 275"
                            role="group"
                            aria-label={`每日趋势：${label}`}
                        >
                            {[0, 1, 2, 3, 4].map((i) => (
                                <g key={i} aria-hidden="true">
                                    <line
                                        x1="75"
                                        y1={230 - i * 47.5}
                                        x2="965"
                                        y2={230 - i * 47.5}
                                        className="dashboard-chart-grid"
                                    />
                                    <text
                                        x="64"
                                        y={234 - i * 47.5}
                                        textAnchor="end"
                                    >
                                        {((maximum * i) / 4).toLocaleString(
                                            undefined,
                                            {
                                                notation: "compact",
                                                maximumFractionDigits: integer
                                                    ? 0
                                                    : 2,
                                            },
                                        )}
                                    </text>
                                </g>
                            ))}
                            {points.map(
                                (point, i) =>
                                    (i === points.length - 1 ||
                                        i %
                                            Math.max(
                                                1,
                                                Math.ceil(points.length / 6),
                                            ) ===
                                            0) && (
                                        <text
                                            key={point.date}
                                            x={x(point.time)}
                                            y="262"
                                            textAnchor="middle"
                                            aria-hidden="true"
                                        >
                                            {point.date.slice(5)}
                                        </text>
                                    ),
                            )}
                            {segments.map((segment, i) => (
                                <polyline
                                    key={i}
                                    points={segment
                                        .map(
                                            (point) =>
                                                `${x(point.time)},${y(point.value)}`,
                                        )
                                        .join(" ")}
                                    className="dashboard-chart-line"
                                />
                            ))}
                            {valid.map((point) => (
                                <circle
                                    key={point.date}
                                    cx={x(point.time)}
                                    cy={y(point.value)}
                                    r={active?.date === point.date ? 6 : 4}
                                    className="dashboard-chart-point"
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${point.date} · ${label}：${format(point.value)}`}
                                    onFocus={() => setSelected(point.date)}
                                    onMouseEnter={() => setSelected(point.date)}
                                    onClick={() => setSelected(point.date)}
                                    onKeyDown={(event) => {
                                        if (
                                            event.key === "Enter" ||
                                            event.key === " "
                                        ) {
                                            event.preventDefault();
                                            setSelected(point.date);
                                        }
                                    }}
                                >
                                    <title>
                                        {point.date} · {format(point.value)}
                                    </title>
                                </circle>
                            ))}
                        </svg>
                    </div>
                    <details className="dashboard-chart-data">
                        <summary>查看每日数据</summary>
                        <Table
                            data={valid}
                            columns={[
                                ["date", "日期"],
                                ["value", label, (row) => format(row.value)],
                            ]}
                        />
                    </details>
                </>
            )}
        </figure>
    );
}
