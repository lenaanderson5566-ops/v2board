import { formatNumber, formatPercent } from "../shared/number-format";
import { AdminChoiceGroup } from "./AdminChoices";
import { adminBusinessInstant, logTime } from "./admin-log-time";
import { businessTimeZone } from "../shared/timezone";
import { AdminSubscriptionProtection } from "./AdminSubscriptionProtection";
import { AdminUserActivityLink } from "./AdminUserActivity";
import { AdminRiskReview } from "./AdminRiskReview";
import { useState } from "react";
import "./admin-risk.css";
import { ops, query, request, rows, type Row } from "../shared/api";
import {
    useData,
    State,
    Panel,
    Metric,
    Pager,
    Table,
    Editor,
    Modal,
    type Field,
} from "../shared/ui";

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
    const [window, setWindow] = useState("today"), [reviewOpen, setReviewOpen] = useState(false);
    const d = useData(ops(`risk/summary/fetch?window=${window}&view=dashboard`));
    const backlog = d.data?.review_queue;
    const blacklist = d.data?.blacklist;
    const trend = rows(blacklist?.trend);
    const max = Math.max(0, ...trend.map((r) => r.ip + r.ua));
    return (
        <div className="risk-workspace">
            <Panel padded title="高风险订阅信号待复核">
                <p className="muted">汇总所有尚未复核的高风险订阅行为信号，按最早记录优先处理，不随下方统计范围变化。复核记录结论，不会自动拦截。</p>
                {backlog && <p>
                    <strong>{backlog.total} 条待复核</strong> · 涉及 {backlog.accounts} 个账号
                    {backlog.oldest_at != null && <> · 最早 {logTime(backlog.oldest_at)}</>}
                </p>}
                {(backlog?.total > 0 || reviewOpen) && <button type="button" aria-expanded={reviewOpen} onClick={() => setReviewOpen(!reviewOpen)}>
                    {reviewOpen ? "收起待复核队列" : "打开待复核队列"}
                </button>}
                {reviewOpen && <RiskReviewQueue onReviewed={d.reload} />}
            </Panel>
            <div className="actions risk-toolbar">
                <AdminChoiceGroup
                    label="风控统计时间范围"
                    value={window}
                    onChange={setWindow}
                    options={[
                        { value: "today", label: "近 24 小时" },
                        { value: "7d", label: "近 7 天" },
                        { value: "30d", label: "近 30 天" },
                    ]}
                />
                <button onClick={d.reload} disabled={d.loading}>刷新统计</button>
            </div>
            <State {...d} retry={d.reload}>
                <Panel padded title="订阅黑名单拦截">
                    <div className="metrics risk-block-metrics">
                        <Metric label="IP 黑名单拦截" value={blacklist?.ip ?? 0} />
                        <Metric label="UA 黑名单拦截" value={blacklist?.ua ?? 0} />
                    </div>
                    <p className="muted">按订阅日志中的实际黑名单拦截请求计数，发生在账号识别前，同一来源可重复请求。统计范围仅含已记录的 IP 和 UA 黑名单拦截。</p>
                    <p className="muted">时间轴按业务时区 {businessTimeZone()} 标注{window === "today" ? "固定小时区间" : "业务日期"}；首尾区间可能不完整。</p>
                    {max > 0 ? <div className="risk-trend" aria-label="订阅黑名单拦截趋势">
                        {trend.map((r) => (
                            <div key={r.at} title={`${adminBusinessInstant(r.at)} · ${businessTimeZone()} · IP ${r.ip} 次 · UA ${r.ua} 次`}>
                                <span>{r.ip + r.ua || ""}</span>
                                <i style={{ height: `${Math.max(2, ((r.ip + r.ua) / max) * 110)}px` }} />
                                <small>
                                    {adminBusinessInstant(r.at, window === "today"
                                        ? {year: undefined, month: undefined, day: undefined, hour: "2-digit", minute: undefined, second: undefined}
                                        : {year: undefined, month: "numeric", day: "numeric", hour: undefined, minute: undefined, second: undefined})}
                                </small>
                            </div>
                        ))}
                    </div> : <p>所选范围内无已记录的黑名单拦截。</p>}
                    <div className="actions">
                        <a href="#/access-blacklist">检查 IP 黑名单</a>
                        <a href="#/access-blacklist-ua">检查 UA 黑名单</a>
                        <a href="#/access-logs-subscriptions">查看订阅请求与访问质量</a>
                    </div>
                </Panel>
                <Panel padded title="订阅行为规则复核结果">
                    <Table data={rows(d.data?.rules)} columns={[
                        ["name", "规则"], ["hits", "信号数"], ["accounts", "涉及账号"],
                        ["confirmed", "确认异常"],
                        ["false_positives", "误报 / 已判定", (r) => {
                            const decided = r.confirmed + r.false_positives;
                            return decided ? `${r.false_positives} / ${decided}（${formatPercent(r.false_positives / decided, { fraction: true, bounded: true })}）` : "暂无判定";
                        }],
                    ]} />
                    <p className="muted">按命中时间入选，账号按规则去重。误报比例仅以人工确认或判为误报的记录为样本；样本少时应结合命中证据核对阈值。</p>
                    <div className="actions">
                        <a href="#/access-logs-risk">查看全部命中证据</a>
                        <a href="#/risk">核对规则与阈值</a>
                    </div>
                </Panel>
            </State>
        </div>
    );
}

function RiskReviewQueue({ onReviewed }: { onReviewed: () => void }) {
    const [page, setPage] = useState(1), [size, setSize] = useState(10);
    const d = useData<Row[]>(query(ops("log/rule-hit/fetch"), { review_queue: 1, current: page, page_size: size }));
    const list = rows(d.data);
    return <div className="risk-review-queue">
        <State {...d} retry={d.reload}>
            <Table data={list} columns={[
                ["user_id", "用户（ID / 邮箱）", (r) => <AdminUserActivityLink row={r} />],
                ["rule_name", "规则"],
                ["hit_at", "命中时间", (r) => logTime(r.hit_at)],
                ["review", "人工复核", (r) => <AdminRiskReview key={r.id} row={r} grouped={false} onSaved={() => {
                    onReviewed();
                    if (page > 1 && list.length === 1) setPage(page - 1);
                    else d.reload();
                }} />],
            ]} />
            <Pager page={page} total={d.total} size={size} loading={d.loading} onChange={setPage} onSizeChange={(next) => {
                setSize(next);
                setPage(1);
            }} />
        </State>
    </div>;
}

export function RiskRules() {
    const [editBusy, setEditBusy] = useState(false);
    const [editDirty, setEditDirty] = useState(false);
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
                异常检测仅记录事件；拦截由限流与黑名单执行，客户端准入在客户端策略中管理。
            </p>
            <div className="actions pad">
                <a href="#/access-logs-risk">查看命中证据并人工复核</a>
            </div>
            <AdminChoiceGroup
                label="风控规则范围"
                value={scene}
                onChange={setScene}
                options={[
                    { value: "all", label: "全部规则" },
                    { value: "subscribe", label: "订阅" },
                ]}
            />
            {scene !== "login" && <AdminSubscriptionProtection />}
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
                                    {r.enabled
                                        ? "仅记录 · 已启用"
                                        : "仅记录 · 已停用"}
                                </span>
                            </div>
                            <p className="muted">
                                {r.scene === "login" ? "登录行为" : "订阅访问"}{" "}
                                ·{" "}
                                {r.rule_key.includes("blacklist")
                                    ? "订阅黑名单命中记录"
                                    : "异常行为记录"}
                            </p>
                            {r.description && <p className="muted">
                                {r.thresholds?.window_seconds ? "默认触发条件 · " : ""}
                                {r.description}
                            </p>}
                            <dl>
                                {Object.entries(r.thresholds || {}).map(
                                    ([key, value]) => (
                                        <div key={key}>
                                            <dt>
                                                {thresholdLabels[key] || key}
                                            </dt>
                                            <dd>
                                                {formatNumber(value, { maximumFractionDigits: 0 })}{" "}
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
                            <button onClick={() => { setEditDirty(false); setEdit(r); }}>调整规则</button>
                        </article>
                    ))}
                </div>
            </State>
            {edit && (
                <Modal title={`编辑风控规则 · ${edit.name}`} guardChanges dismissible={!editBusy} close={() => setEdit(null)}>
                    <p className="pad muted admin-dialog-intro">
                        保存后用于后续请求；不会清除历史命中记录。
                    </p>
                    <Editor
                        key={`${edit.rule_key}-${revision}`}
                        onBusyChange={setEditBusy}
                        onDirty={() => setEditDirty(true)}
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
                    >
                    <button type="button" disabled={editBusy}
                        onClick={() => {
                            if (editDirty && !window.confirm("填入建议阈值会重置当前表单，确认放弃未保存的修改？")) return;
                            setEditDirty(false);
                            setEdit({
                                ...edit,
                                thresholds: edit.default_thresholds || {},
                            });
                            setRevision((v) => v + 1);
                        }}
                    >
                        填入建议阈值
                    </button>
                    </Editor>
                </Modal>
            )}
        </>
    );
}
