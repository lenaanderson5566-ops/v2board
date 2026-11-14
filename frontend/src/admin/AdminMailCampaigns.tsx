import "./admin-mail-campaigns.css";
import { formatPercent } from "../shared/number-format";
import { logTime as date } from "./admin-log-time";
import { Html, Modal, Pager, State, useData } from "../shared/ui";
import { useState } from "react";
import { admin, type Row } from "../shared/api";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { tx } from "../shared/i18n";
import { AdminDetails } from "./admin-section";
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
const deliveryFields = [
    ["total", "总人数"],
    ["queued", "排队"],
    ["sending", "发送中"],
    ["accepted", "已接受"],
    ["failed", "失败"],
    ["uncertain", "不确定"],
    ["skipped", "跳过"],
    ["delivered", "确认送达"],
    ["bounced", "永久退信"],
    ["complaints", "投诉"],
    ["rejected", "拒绝"],
    ["temporary", "延迟"],
    ["unsubscribed", "退订"],
] as const;

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
    const translations = Object.entries(campaign?.translations || {}) as [string, Row][];
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
                <div className="mail-campaign-row" key={row.id}>
                    <button type="button" onClick={() => setId(Number(row.id))}>
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
                <Modal
                    title="群发记录"
                    variant="drawer"
                    wide
                    className="admin-detail-dialog"
                    close={() => setId(null)}
                >
                    <div className="admin-detail-body">
                        {(detail.loading || detail.error) && (
                            <State {...detail} retry={detail.reload}>{null}</State>
                        )}
                        {campaign && (
                            <>
                                <section className="admin-detail-section">
                                    <h3>{campaign.subject}</h3>
                                    <AdminDetails className="admin-detail-grid" items={[
                                        { label: "用途", value: campaign.purpose === "service" ? "必要服务通知" : "活动与推广" },
                                        { label: "管理员", value: `#${campaign.administrator_id}` },
                                        { label: "创建时间", value: date(campaign.created_at) },
                                    ]} />
                                    <div className="mail-campaign-content" role="region" aria-label="邮件原文" tabIndex={0}>
                                        <Html value={campaign.content} />
                                    </div>
                                </section>
                                {translations.length > 0 && (
                                    <section className="admin-detail-section mail-campaign-translations">
                                        <h3>译文</h3>
                                        {translations.map(([language, value]) => (
                                            <details key={language}>
                                                <summary>{language} · {value.subject}</summary>
                                                <div
                                                    className="mail-campaign-content"
                                                    role="region"
                                                    aria-label={`${language} 邮件译文`}
                                                    tabIndex={0}
                                                >
                                                    <Html value={value.content} />
                                                </div>
                                            </details>
                                        ))}
                                    </section>
                                )}
                                <section className="admin-detail-section">
                                    <div className="admin-detail-section-head">
                                        <h3>投递统计</h3>
                                        <button
                                            type="button"
                                            disabled={detail.loading || list.loading || retryIn > 0}
                                            aria-busy={detail.loading || list.loading}
                                            onClick={() => {
                                                detail.reload();
                                                list.reload();
                                            }}
                                        >
                                            {retryIn > 0 ? tx("retryIn", { ns: "pricing", seconds: retryIn }) : "更新投递状态"}
                                        </button>
                                    </div>
                                    <AdminDetails className="admin-detail-grid" items={deliveryFields.map(([key, label]) => ({
                                        label,
                                        value: stats?.[key],
                                    }))} />
                                    <p>
                                        确认送达比例：
                                        {stats?.feedback_count && stats.delivery_rate != null
                                            ? formatPercent(stats.delivery_rate, { bounded: true })
                                            : "暂无可靠反馈"}
                                        （可能仍有回调未到达，不代表打开率）
                                    </p>
                                    {(stats?.skipped_reasons || []).map((r: Row) => (
                                        <p key={r.reason}>
                                            {reasons[r.reason] || "其他原因"}：{r.n}
                                        </p>
                                    ))}
                                </section>
                            </>
                        )}
                    </div>
                </Modal>
            )}
        </section>
    );
}
