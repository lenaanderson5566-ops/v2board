import { useState } from "react";
import "./admin-risk.css";
import { ops, request, rows, date, type Row } from "./api";
import {
    useData,
    State,
    Panel,
    Metric,
    Table,
    Editor,
    Modal,
    type Field,
} from "./ui";

const level: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
};
const thresholdLabels: Record<string, string> = {
    threshold: "命中阈值",
    subscribe_threshold: "订阅请求阈值",
    window_seconds: "统计窗口",
    traffic_growth_threshold_bytes: "流量增长上限",
};

export function RiskOverview() {
    const [window, setWindow] = useState("today");
    const d = useData(ops(`risk/summary/fetch?window=${window}`));
    const data = d.data || {};
    const trend = rows(data.trend);
    const max = Math.max(1, ...trend.map((r) => Number(r.hits)));
    return (
        <div className="risk-workspace">
            <div className="actions risk-toolbar">
                <div className="section-tabs">
                    {[
                        ["today", "近 24 小时"],
                        ["7d", "近 7 天"],
                        ["30d", "近 30 天"],
                    ].map(([key, label]) => (
                        <button
                            key={key}
                            className={window === key ? "selected" : ""}
                            onClick={() => setWindow(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <a className="button" href="#/risk">
                    管理规则
                </a>
                <button onClick={d.reload}>刷新</button>
            </div>
            <State {...d} retry={d.reload}>
                <div className="metrics">
                    <Metric
                        label="规则命中"
                        value={data.total || 0}
                        detail="同一请求可能命中多条规则"
                    />
                    <Metric
                        label="高风险命中"
                        value={data.high || 0}
                        detail="优先核查异常行为"
                    />
                    <Metric
                        label="涉及用户"
                        value={data.users || 0}
                        detail="不含未识别账号的请求"
                    />
                    <Metric
                        label="启用规则"
                        value={`${data.enabled_rules || 0} / ${data.total_rules || 0}`}
                        detail="规则命中不等于自动封禁"
                    />
                </div>
                <div className="split">
                    <Panel title="命中趋势">
                        <div className="risk-trend" aria-label="风控命中趋势">
                            {trend.map((r) => (
                                <div
                                    key={r.at}
                                    title={`${date(r.at)} · ${r.hits} 次`}
                                >
                                    <span>{r.hits || ""}</span>
                                    <i
                                        style={{
                                            height: `${Math.max(2, (r.hits / max) * 110)}px`,
                                        }}
                                    />
                                    <small>
                                        {new Date(r.at * 1000).toLocaleString(
                                            "zh-CN",
                                            window === "today"
                                                ? {
                                                      hour: "2-digit",
                                                      hour12: false,
                                                  }
                                                : {
                                                      month: "numeric",
                                                      day: "numeric",
                                                  },
                                        )}
                                    </small>
                                </div>
                            ))}
                        </div>
                    </Panel>
                    <Panel title="高频命中规则">
                        <Table
                            data={rows(data.ranking)}
                            columns={[
                                ["name", "规则"],
                                ["hits", "命中次数"],
                            ]}
                        />
                    </Panel>
                </div>
                <Panel title="近期风控事件">
                    <Table
                        data={rows(data.recent)}
                        columns={[
                            ["name", "规则"],
                            [
                                "risk_level",
                                "等级",
                                (r) => (
                                    <span
                                        className={`risk-level ${r.risk_level}`}
                                    >
                                        {level[r.risk_level] || r.risk_level}
                                    </span>
                                ),
                            ],
                            ["user_id", "用户", (r) => r.user_id || "未识别"],
                            ["ip", "IP"],
                            ["hit_at", "时间", (r) => date(r.hit_at)],
                        ]}
                    />
                </Panel>
                <div className="actions pad">
                    <a href="#/log-risk">全部命中记录</a>
                    <a href="#/blacklist-ip">IP 黑名单</a>
                    <a href="#/blacklist-ua">UA 黑名单</a>
                </div>
            </State>
        </div>
    );
}

export function RiskRules() {
    const d = useData<Row[]>(ops("risk/rule/fetch"));
    const [scene, setScene] = useState("all"),
        [edit, setEdit] = useState<Row | null>(null),
        [revision, setRevision] = useState(0);
    const rules = rows(d.data).filter(
        (r) => scene === "all" || r.scene === scene,
    );
    const fields: Field[] = edit
        ? [
              { key: "enabled", label: "启用规则记录", type: "switch" },
              {
                  key: "risk_level",
                  label: "风险等级",
                  type: "select",
                  options: [
                      ["low", "低风险"],
                      ["medium", "中风险"],
                      ["high", "高风险"],
                  ],
              },
              ...Object.keys(edit.thresholds || {}).map((key) => ({
                  key,
                  label: thresholdLabels[key] || key,
                  type: "number" as const,
                  required: true,
                  step: 1,
                  min:
                      key === "window_seconds"
                          ? 60
                          : key === "traffic_growth_threshold_bytes"
                            ? 0
                            : 1,
                  max: key === "window_seconds" ? 2592000 : undefined,
                  unit:
                      key === "window_seconds"
                          ? "秒"
                          : key === "traffic_growth_threshold_bytes"
                            ? "字节"
                            : "次 / 个",
                  hint:
                      key === "traffic_growth_threshold_bytes"
                          ? "50 MiB = 52428800 字节"
                          : undefined,
              })),
          ]
        : [];
    return (
        <>
            <p className="pad muted">
                规则用于识别和记录异常；风险等级用于排查排序。需要限制访问时，请配置黑名单或客户端策略。
            </p>
            <div className="section-tabs">
                {[
                    ["all", "全部规则"],
                    ["login", "登录"],
                    ["subscribe", "订阅"],
                ].map(([key, label]) => (
                    <button
                        key={key}
                        className={scene === key ? "selected" : ""}
                        onClick={() => setScene(key)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <State {...d} retry={d.reload}>
                <div className="risk-rule-grid">
                    {rules.map((r) => (
                        <article className="risk-rule-card" key={r.rule_key}>
                            <div className="actions">
                                <strong>{r.name}</strong>
                                <span className={`risk-level ${r.risk_level}`}>
                                    {level[r.risk_level]}
                                </span>
                                <span className="muted">
                                    {r.enabled ? "已启用" : "已停用"}
                                </span>
                            </div>
                            <p className="muted">
                                {r.scene === "login" ? "登录行为" : "订阅访问"}{" "}
                                ·{" "}
                                {r.rule_key.includes("blacklist")
                                    ? "黑名单命中记录"
                                    : "异常行为记录"}
                            </p>
                            <dl>
                                {Object.entries(r.thresholds || {}).map(
                                    ([key, value]) => (
                                        <div key={key}>
                                            <dt>
                                                {thresholdLabels[key] || key}
                                            </dt>
                                            <dd>
                                                {Number(value).toLocaleString()}{" "}
                                                {key === "window_seconds"
                                                    ? "秒"
                                                    : key ===
                                                        "traffic_growth_threshold_bytes"
                                                      ? "字节"
                                                      : ""}
                                            </dd>
                                        </div>
                                    ),
                                )}
                            </dl>
                            <button onClick={() => setEdit(r)}>调整规则</button>
                        </article>
                    ))}
                </div>
            </State>
            {edit && (
                <Modal title={edit.name} close={() => setEdit(null)}>
                    <p className="muted">
                        保存后用于后续请求；不会清除历史命中记录。
                    </p>
                    <Editor
                        key={`${edit.rule_key}-${revision}`}
                        fields={fields}
                        initial={{
                            enabled: !!edit.enabled,
                            risk_level: edit.risk_level,
                            ...edit.thresholds,
                        }}
                        onSave={async (values) => {
                            const thresholds = Object.fromEntries(
                                Object.keys(edit.thresholds || {}).map((k) => [
                                    k,
                                    Number(values[k]),
                                ]),
                            );
                            await request(ops("risk/rule/update"), {
                                rule_key: edit.rule_key,
                                enabled: values.enabled,
                                risk_level: values.risk_level,
                                thresholds,
                            });
                            setEdit(null);
                            d.reload();
                        }}
                    />
                    <button
                        onClick={() => {
                            setEdit({
                                ...edit,
                                thresholds: edit.default_thresholds || {},
                            });
                            setRevision((v) => v + 1);
                        }}
                    >
                        填入建议阈值
                    </button>
                </Modal>
            )}
        </>
    );
}
