import { logTime as date } from "./admin-log-time";
import { RiskEvidence } from "./RiskEvidence";
import { adminUserLabel } from "./admin-user-label";
import { useRef, useState } from "react";
import { ops, request, type Row } from "../shared/api";
import { Modal } from "../shared/ui";
import { StatusBadge, type StatusTone } from "../shared/StatusBadge";
import { AdminDetails } from "./admin-section";
const states: Record<string, string> = { pending: "待处理", confirmed: "已确认", false_positive: "误报", ignored: "已忽略" };
const tones: Record<string, StatusTone> = { pending: "warning", confirmed: "danger", false_positive: "neutral", ignored: "neutral" };
const requestResults: Record<string, string> = { success: "成功", failed: "失败" };
const evidence: Record<string, string> = { threshold: "命中阈值", window_seconds: "统计窗口（秒）", failed_count: "失败次数", distinct_ip_count: "不同 IP 数", request_count: "请求次数", subscribe_count: "成功订阅次数", subscribe_threshold: "订阅次数阈值", traffic_growth_bytes: "流量增长（字节）", traffic_growth_threshold_bytes: "流量增长上限（字节）", distinct_client_type_count: "客户端类型数", ip: "命中 IP", ua_hash: "命中 UA 哈希" };
export function AdminRiskReview({ row, grouped = true, onSaved }: { row: Row; grouped?: boolean; onSaved?: () => void }) {
    const [open, setOpen] = useState(false);
    const [review, setReview] = useState(row.payload?.review || {});
    const [state, setState] = useState(review.state || "pending");
    const [note, setNote] = useState(review.note || "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    const dirty = state !== (review.state || "pending") || note !== (review.note || "");
    function dismiss() {
        if (pending.current) return;
        if (dirty && !window.confirm("复核修改尚未保存，确认放弃？")) return;
        setState(review.state || "pending");
        setNote(review.note || "");
        setError("");
        setOpen(false);
    }
    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await request(ops("log/rule-hit/review"), { id: row.id, state, note });
            setReview({ state, note });
            setOpen(false);
            onSaved?.();
        } catch (reason) {
            setError((reason as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return <>
        <div className="actions">
            <StatusBadge tone={tones[review.state] || "warning"}>{states[review.state] || "待处理"}</StatusBadge>
            <button type="button" onClick={() => setOpen(true)}>查看证据</button>
        </div>
        {open && <Modal title="命中证据与人工复核" close={dismiss} dismissible={!busy}>
            <div className="pad">
                <p>{adminUserLabel(row)}</p><p>{row.rule_name || "历史规则"} · {date(row.hit_at)}</p>
                <p className="muted">复核仅针对{grouped ? "这组中最新一条" : "当前"}原始记录（#{row.id}），不封禁用户、不修改其他命中。IP 或客户端类型数量不等于设备数量。</p>
                {row.scene === "subscribe" && <AdminDetails items={[
                    { label: "原订阅请求结果", value: requestResults[row.status] || row.status || "—" },
                    ...(row.reason === "config_check" ? [{ label: "请求类型", value: "配置修订检查" }] : []),
                    { label: "请求来源 IP", value: row.ip || "—" },
                    ...(row.payload?.source_log_id != null
                        ? [{ label: "原订阅日志 ID", value: String(row.payload.source_log_id) }]
                        : []),
                ]} />}
                <RiskEvidence payload={row.payload} />
                <AdminDetails items={Object.entries(row.payload || {}).filter(([key]) => evidence[key]).map(([key, value]) => ({label: evidence[key], value: String(value)}))} />
                {!Object.keys(row.payload || {}).some(key => evidence[key]) && <p>此历史记录没有可展示的命中数值。</p>}
                {row.payload?.review_history?.length > 0 && <details><summary>复核历史</summary>{row.payload.review_history.map((entry: Row, index: number) => <p key={index}>{date(entry.at)} · 管理员 #{entry.admin_id ?? "—"} · {states[entry.state] || entry.state}：{entry.note || "无备注"}</p>)}</details>}
                {row.scene === "subscribe" && <section aria-label="人工处置入口">
                    <p className="muted">确认异常并需要拦截时，请到订阅黑名单核对范围后另行添加。共享 IP 可能影响其他账号。</p>
                    <div className="actions">
                        <a href="#/access-blacklist" target="_blank" rel="noopener noreferrer">打开订阅 IP 黑名单</a>
                        <a href="#/access-blacklist-ua" target="_blank" rel="noopener noreferrer">打开订阅 UA 黑名单</a>
                    </div>
                </section>}
                <form className="admin-dialog-form" aria-busy={busy} data-unsaved={dirty ? "true" : undefined} onSubmit={save}>
                    <label>复核状态<select disabled={busy} value={state} onChange={event => setState(event.target.value)}>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                    <label>备注<textarea disabled={busy} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
                    {error && <p role="alert" className="alert">{error}</p>}
                    <div className="admin-dialog-actions">
                        <button type="button" disabled={busy} onClick={dismiss}>取消</button>
                        <button className="primary" disabled={busy}>{busy ? "保存中…" : "保存复核"}</button>
                    </div>
                </form>
            </div>
        </Modal>}
    </>;
}
