import { formatPercent } from "../shared/number-format";
import { logTime as date } from "./admin-log-time";
import { Pager } from "../shared/ui";
import { useState } from "react";
import { admin, type Row } from "../shared/api";
import { useData, Modal, Html, State } from "../shared/ui";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { tx } from "../shared/i18n";
const reasons: Record<string, string> = {
    manual_blocklist: "人工禁发名单",
    account_disabled: "账户已禁用",
    suppressed: "退信或投诉停发",
    not_subscribed: "未订阅推广",
    recipient_changed: "邮箱已变更或账户已删除",
    expired: "任务已过期",
    announcements_paused: "推广已暂停",
    recipient_suppressed: "发送前资格已变化",
};
export function AdminMailCampaigns() {
    const [pageSize, setPageSize] = useState(20);
    const [page, setPage] = useState(1),
        [id, setId] = useState<number | null>(null);
    const list = useData<Row[]>(
        admin(`mail-campaigns/fetch?current=${page}&page_size=${pageSize}`),
    );
    const detail = useData<Row>(
        id ? admin(`mail-campaigns/fetch?id=${id}`) : "",
    );
    const campaign = detail.data?.campaign,
        stats = detail.data?.stats;
    const retryIn = useRetryCountdown(Math.max(list.retryAt || 0, detail.retryAt || 0));
    return (
        <section className="pad">
            <h3>群发记录</h3>
            <p className="muted">
                保留提交时的内容与收件范围。确认送达比例 =
                收件服务器已确认送达人数 ÷
                服务商已接受人数；无回调不表示未送达。SMTP
                通常无法确认最终送达。统计按收件人去重，不按重试次数累计。
            </p>
            <State {...list} retry={list.reload}>
                {null}
            </State>
            {(list.data || []).map((row) => (
                <div className="actions" key={row.id}>
                    <button onClick={() => setId(Number(row.id))}>
                        {row.subject}
                    </button>
                    <span>
                        {row.purpose === "service"
                            ? "必要服务通知"
                            : "活动与推广"}{" "}
                        · {date(row.created_at)} · 已接受 {row.stats.accepted}/
                        {row.stats.total} · 排队 {row.stats.queued} · 跳过{" "}
                        {row.stats.skipped}
                    </span>
                </div>
            ))}
            {!list.loading && !list.error && !list.data?.length && (
                <p className="muted">
                    暂无群发记录，历史单封邮件日志不会反推为群发记录。
                </p>
            )}
            <Pager
                page={page}
                total={list.total}
                size={pageSize}
                loading={list.loading || retryIn > 0}
                onChange={setPage}
                onSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                }}
            />
            {id !== null && (
                <Modal title="群发记录" close={() => setId(null)}>
                    <State {...detail} retry={detail.reload}>
                        {null}
                    </State>
                    {campaign && (
                        <div className="pad">
                            <h3>{campaign.subject}</h3>
                            <p>
                                {campaign.purpose === "service"
                                    ? "必要服务通知"
                                    : "活动与推广"}{" "}
                                · 管理员 #{campaign.administrator_id} ·{" "}
                                {date(campaign.created_at)}
                            </p>
                            <Html value={campaign.content} />
                            {Object.entries(campaign.translations || {}).map(
                                ([language, value]) => {
                                    const v = value as Row;
                                    return (
                                        <details key={language}>
                                            <summary>
                                                {language} · {v.subject}
                                            </summary>
                                            <Html value={v.content} />
                                        </details>
                                    );
                                },
                            )}
                            <h4>投递统计</h4>
                            <p>
                                总人数 {stats.total} · 排队 {stats.queued} ·
                                发送中 {stats.sending} · 已接受 {stats.accepted}{" "}
                                · 失败 {stats.failed} · 不确定 {stats.uncertain}{" "}
                                · 跳过 {stats.skipped}
                            </p>
                            <p>
                                确认送达 {stats.delivered} · 永久退信{" "}
                                {stats.bounced} · 投诉 {stats.complained} · 拒绝{" "}
                                {stats.rejected} · 延迟 {stats.temporary} · 退订{" "}
                                {stats.unsubscribed}
                            </p>
                            <p>
                                确认送达比例：
                                {stats.feedback_count &&
                                stats.delivery_rate !== null
                                    ? formatPercent(stats.delivery_rate, { bounded: true })
                                    : "暂无可靠反馈"}
                                （可能仍有回调未到达，不代表打开率）
                            </p>
                            {(stats.skipped_reasons || []).map((r: Row) => (
                                <p key={r.reason}>
                                    {reasons[r.reason] || "其他原因"}：{r.n}
                                </p>
                            ))}
                            <button type="button" disabled={detail.loading || list.loading || retryIn > 0}
                                aria-busy={detail.loading || list.loading}
                                onClick={() => {
                                    detail.reload();
                                    list.reload();
                                }}
                            >{retryIn > 0 ? tx("retryIn", { ns: "pricing", seconds: retryIn }) : "更新投递状态"}</button>
                        </div>
                    )}
                </Modal>
            )}
        </section>
    );
}
