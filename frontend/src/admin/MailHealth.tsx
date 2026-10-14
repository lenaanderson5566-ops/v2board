import { Pager } from "../shared/ui";
import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { useData, State } from "../shared/ui";
import { formatInstant } from "../shared/timezone";
export function MailHealth() {
    const [pageSize, setPageSize] = useState(20);
    const health = useData<Row>(admin("mail-logs/health"));
    const [email, setEmail] = useState(""),
        [filter, setFilter] = useState(""),
        [page, setPage] = useState(1),
        [busy, setBusy] = useState(""),
        [error, setError] = useState("");
    const suppressed = useData<Row[]>(
        admin(
            `mail-logs/suppressions?current=${page}&page_size=${pageSize}&email=${encodeURIComponent(filter)}`,
        ),
    );
    const count = (field: string, value: string) =>
        (health.data?.counts || [])
            .filter((r: Row) => r[field] === value)
            .reduce((n: number, r: Row) => n + Number(r.count), 0);
    async function release(row: Row) {
        if (
            !window.confirm(
                "确认已核实该邮箱可接收邮件？这不会重发历史邮件，也不会恢复服务商自己的抑制名单。",
            )
        )
            return;
        setBusy(row.recipient_hash);
        setError("");
        try {
            await request(admin("mail-logs/release"), {
                recipient_hash: row.recipient_hash,
                verified: true,
            });
            suppressed.reload();
            health.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy("");
        }
    }
    return (
        <div className="pad">
            <State {...health} retry={health.reload}>
                <p>
                    近 24 小时邮件任务：服务商接受 {count("status", "accepted")}{" "}
                    · 失败 {count("status", "failed")} · 不确定{" "}
                    {count("status", "uncertain")} · 跳过{" "}
                    {count("status", "skipped")}；其中已收到反馈：送达服务器{" "}
                    {count("delivery_status", "delivered")} · 永久退信{" "}
                    {count("delivery_status", "bounced")} · 投诉{" "}
                    {count("delivery_status", "complained")}
                </p>
                <p className="muted">
                    反馈不完整时不能据此计算送达率；待关联事件{" "}
                    {health.data?.unmatched_events || 0}，限制发送地址{" "}
                    {health.data?.suppressed || 0}。
                </p>
            </State>
            <details>
                <summary>邮件抑制名单（永久退信 / 投诉）</summary>
                <p className="muted">
                    只限制向该地址发邮件，不禁用网站账号。投诉地址不能直接恢复；永久退信需先核实邮箱。服务商抑制名单需另外处理。
                </p>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        setFilter(email.trim());
                        setPage(1);
                    }}
                >
                    <label>
                        精确邮箱
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                    <button>查询</button>
                </form>
                {error && <p role="alert">{error}</p>}
                <State {...suppressed} retry={suppressed.reload}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>邮箱</th>
                                    <th>原因</th>
                                    <th>时间</th>
                                    <th>处理</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(suppressed.data || []).map((row) => (
                                    <tr key={row.recipient_hash}>
                                        <td>{row.email}</td>
                                        <td>
                                            {row.reason === "complained"
                                                ? "用户投诉"
                                                : "永久退信"}
                                        </td>
                                        <td>{formatInstant(row.updated_at)}</td>
                                        <td>
                                            <button
                                                disabled={
                                                    !!busy ||
                                                    row.reason === "complained"
                                                }
                                                onClick={() => release(row)}
                                            >
                                                核实后恢复
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </State>
                <Pager
                    page={page}
                    total={suppressed.total}
                    size={pageSize}
                    loading={suppressed.loading}
                    onChange={setPage}
                    onSizeChange={(size) => {
                        setPageSize(size);
                        setPage(1);
                    }}
                />
            </details>
        </div>
    );
}
