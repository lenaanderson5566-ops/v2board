import { TableViewport } from "../shared/ui";
import { adminInstant as formatInstant } from "./admin-log-time";
import { useRef, useState } from "react";
import { admin, request } from "../shared/api";
import { Reload, State, useData } from "../shared/ui";

export function AdminTelegramCommunity({ disabled }: { disabled: boolean }) {
    const d = useData(admin("telegram/status"));
    const inFlight = useRef(false);
    const [busy, setBusy] = useState(false);
    const [ids, setIds] = useState("");
    const [message, setMessage] = useState("");
    async function run(action: string) {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setMessage("");
        try {
            const response = await request(
                admin(`telegram/${action}`),
                action === "import"
                    ? { telegramIds: ids.split(/[\s,，]+/).filter(Boolean) }
                    : {},
            );
            if (action === "inspect") {
                const r = response.data;
                setMessage(
                    `${r.chatTitle} · @${r.botUsername}；管理员：${r.administrator ? "是" : "否"}；批准入群：${r.canInvite ? "允许" : "缺失"}；清退：${r.canRestrict ? "允许" : "缺失"}；${r.isPrivate ? "私有群" : "公开群，建议改为私有群"}`,
                );
            } else {
                setMessage(
                    `已接收 ${response.data.imported} 个成员 ID，将由计划任务检查资格。`,
                );
                setIds("");
            }
            d.reload();
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    return (
        <section aria-label="Telegram 群管理">
            <h3>群成员资格</h3>
            <p className="muted">
                推荐使用私有超级群，将机器人设为管理员并授予邀请成员、限制成员权限。保存配置后重新设置
                Webhook。资格依据套餐有效期，流量用尽不影响；默认宽限 3 天。
            </p>
            <p className="muted">
                计划任务分批检查已知成员。Telegram
                不提供完整历史成员列表：历史未绑定且不活跃的成员需导入
                ID，或由管理员人工核查。群主和管理员不会被自动清退。请撤销绕过审核的旧邀请链接。
            </p>
            <div className="actions">
                <button
                    disabled={disabled || busy}
                    onClick={() => run("inspect")}
                >
                    检查机器人权限
                </button>
                <Reload onClick={d.reload} loading={d.loading} disabled={busy} />
            </div>
            {message && <p role="status">{message}</p>}
            <State {...d} retry={d.reload}>
                {d.data && (
                    <>
                        <p>
                            {d.data.enabled
                                ? "资格管理已启用"
                                : "资格管理未启用"}{" "}
                            · 已知成员 {d.data.knownMembers} · 待检查{" "}
                            {d.data.pendingChecks} · 需关注 {d.data.failures}
                        </p>
                        <p className="muted">
                            上次同步：
                            {d.data.lastSync
                                ? `${formatInstant(d.data.lastSync.at)}，检查 ${d.data.lastSync.checked}，失败 ${d.data.lastSync.failed}`
                                : "尚未执行，请确认服务器计划任务正常运行"}
                        </p>
                        <h3>事件与到账通知</h3>
                        <p className="muted">Webhook 待处理 {d.data.webhookCounts?.pending || 0} · 失败 {d.data.webhookCounts?.failed || 0} · 结果不确定 {d.data.webhookCounts?.uncertain || 0}</p>
                        <p className="muted">到账提醒待发送 {d.data.paymentNoticeCounts?.pending || 0} · 已发送 {d.data.paymentNoticeCounts?.sent || 0} · 失败 {d.data.paymentNoticeCounts?.failed || 0} · 结果不确定 {d.data.paymentNoticeCounts?.uncertain || 0}</p>
                        <p className="muted">网络中断后的执行结果可能不确定，不会自动重复发送或操作群成员。请核查 Telegram 实际状态；积压持续增长时检查队列与计划任务。</p>
                        {(d.data.deliveryFailures || []).map((r: any) => <p key={`event-${r.id}`} className="muted">Webhook #{r.id} · {r.status} · {r.error_code}</p>)}
                        {(d.data.paymentFailures || []).map((r: any) => <p key={`payment-${r.id}`} className="muted">到账提醒 #{r.id} · {r.status} · {r.error_code}</p>)}
                        <h3>成员检查记录</h3>
                        <div style={{ overflowX: "auto" }}>
                            <TableViewport><table>
                                <thead>
                                    <tr>
                                        <th>Telegram ID</th>
                                        <th>状态</th>
                                        <th>自动清退</th>
                                        <th>需关注</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(d.data.members || []).map((m: any) => (
                                        <tr key={m.telegram_id}>
                                            <td>{m.telegram_id}</td>
                                            <td>{m.status}</td>
                                            <td>
                                                {m.policy_banned ? "是" : "否"}
                                            </td>
                                            <td>{m.error_code || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></TableViewport>
                        </div>
                        <p className="muted">
                            最多显示 50 条，异常优先。BAN_REQUIRES_REVIEW
                            表示清退结果不确定，请在 Telegram
                            人工核查；人工封禁不会因续费自动解封。
                        </p>
                    </>
                )}
            </State>
            <label htmlFor="telegram-member-import">
                导入历史成员 ID（每行一个，最多 1000 个）
            </label>
            <textarea
                id="telegram-member-import"
                rows={4}
                value={ids}
                onChange={(e) => setIds(e.target.value)}
                style={{ width: "100%" }}
            />
            <button
                disabled={disabled || busy || !ids.trim()}
                onClick={() => run("import")}
            >
                加入资格检查队列
            </button>
        </section>
    );
}
