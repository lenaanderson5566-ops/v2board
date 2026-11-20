import { useRef, useState, type ComponentProps, type FormEvent } from "react";
import { ops, request, type Row } from "../shared/api";
import { Modal, Table } from "../shared/ui";
import { StatusBadge } from "../shared/StatusBadge";
import { AdminUserActivityLink } from "./AdminUserActivity";
import { AdminRiskReview } from "./AdminRiskReview";
import { logTime } from "./admin-log-time";
import "./admin-risk.css";

const outcomes = { confirmed: "已确认", false_positive: "误报", ignored: "已忽略" };
const levels: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险" };
export const pendingRiskColumns: ComponentProps<typeof Table>["columns"] = [
    ["user_id", "用户（ID / 邮箱）", row => <AdminUserActivityLink row={row} />],
    ["rule_name", "规则"],
    ["risk_level", "风险等级", row => <StatusBadge tone={row.risk_level === "high" ? "danger" : row.risk_level === "medium" ? "warning" : "neutral"}>{levels[row.risk_level] || "未知"}</StatusBadge>],
    ["ip", "IP"], ["status", "原请求结果"],
    ["hit_at", "命中时间", row => logTime(row.hit_at)],
];

export function PendingRiskHits({ hits, disabled, onReviewed, selectedColumns }: {
    hits: Row[];
    disabled: boolean;
    onReviewed: (message?: string) => void;
    selectedColumns?: string[];
}) {
    const [selected, setSelected] = useState<number[]>([]);
    const [batch, setBatch] = useState<number[] | null>(null);
    const [state, setState] = useState("");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    const eligible = hits.filter(row => Number.isSafeInteger(row.id) && row.id > 0 &&
        !Object.hasOwn(outcomes, row.payload?.review?.state ?? "")).map(row => row.id as number);
    const ids = eligible.filter(id => selected.includes(id));
    const allSelected = ids.length > 0 && ids.length === eligible.length;
    const blocked = disabled || busy;

    function dismiss() {
        if (pending.current) return;
        if ((state || note) && !window.confirm("放弃本次批量复核的修改？")) return;
        setBatch(null);
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!batch?.length || !state || pending.current || disabled) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            const { data } = await request<{ updated: number; skipped: number }>(
                ops("log/rule-hit/review"), { ids: batch, state, note: note.trim() },
            );
            setBatch(null);
            setSelected([]);
            onReviewed(`已更新 ${data.updated} 条记录${data.skipped ? `，跳过 ${data.skipped} 条已处理或已移除的记录` : ""}。`);
        } catch (cause) {
            setError((cause as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }

    return <>
        <div className="actions pad">
            <label className="risk-hit-selection"><input type="checkbox" checked={allSelected}
                ref={el => { if (el) el.indeterminate = ids.length > 0 && !allSelected; }}
                disabled={blocked || !eligible.length}
                onChange={() => setSelected(allSelected ? [] : eligible)} />选择本页待复核记录</label>
            <span>已选 {ids.length} 条</span>
            <button type="button" disabled={blocked || !ids.length} onClick={() => {
                setBatch(ids); setState(""); setNote(""); setError("");
            }}>批量复核</button>
        </div>
        <Table data={hits} columns={[
            ["id", "记录 ID", row => <label className="risk-hit-selection"><input type="checkbox"
                aria-label={`选择命中记录 #${row.id}`} checked={ids.includes(row.id)}
                disabled={blocked || !eligible.includes(row.id)}
                onChange={event => setSelected(event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} />
                #{row.id}</label>],
            ...pendingRiskColumns.filter(([key]) => !selectedColumns || selectedColumns.includes(key)),
            ["review", "人工复核", row => <AdminRiskReview key={row.id} row={row} grouped={false}
                onSaved={() => { setSelected(ids.filter(id => id !== row.id)); onReviewed(); }} />],
        ]}/>
        {batch && <Modal title="批量复核" close={dismiss} dismissible={!busy}>
            <form className="admin-dialog-form pad" aria-busy={busy} data-unsaved={state || note ? "true" : undefined} onSubmit={submit}>
                <p>将同一结论和备注应用到选中的 <strong>{batch.length} 条</strong>原始命中记录。此操作仅登记复核结果。</p>
                <label>复核结论<select required disabled={busy} value={state} onChange={e => setState(e.target.value)}>
                    <option value="">请选择结论</option>
                    {Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></label>
                <label>统一备注<textarea disabled={busy} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
                {error && <p className="alert" role="alert">{error}</p>}
                <div className="admin-dialog-actions">
                    <button type="button" disabled={busy} onClick={dismiss}>取消</button>
                    <button className="primary" type="submit" disabled={blocked || !state}>{busy ? "保存中…" : "确认复核"}</button>
                </div>
            </form>
        </Modal>}
    </>;
}
