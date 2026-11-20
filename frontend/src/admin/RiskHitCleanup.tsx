import { useEffect, useRef, useState, type FormEvent } from "react";
import { ops, query, request } from "../shared/api";
import { businessTimeZone, calendarDay } from "../shared/timezone";
import { Modal, useData } from "../shared/ui";
import { AdminPagedTable } from "./AdminPagedTable";
import { adminBusinessInstant } from "./admin-log-time";
import { pendingRiskColumns } from "./PendingRiskHits";

const reviewLabels = { confirmed: "已确认", false_positive: "误报", ignored: "已忽略", pending: "待复核" };

interface CleanupRow {
    id: number;
    hit_at: number;
    rule_name: string;
    risk_level: string | null;
    review_state: keyof typeof reviewLabels;
}

interface CleanupPreview {
    matched: number;
    reviewed: number;
    pending: number;
    limit: number;
    token: string | null;
    expires_at: number | null;
    rows: CleanupRow[];
    excluded_pending: number | null;
}

interface CleanupTask {
    id: number;
    state: "queued" | "running" | "failed" | "completed";
    matched: number;
    deleted: number;
    skipped: number;
}

function hasCompletePreview(preview: CleanupPreview, includePending: boolean) {
    const { rows, pending, reviewed, matched } = preview;
    if (![matched, pending, reviewed, preview.limit].every(n => Number.isSafeInteger(n) && n >= 0) ||
        preview.limit === 0 || !Array.isArray(rows) || matched !== pending + reviewed ||
        rows.length !== Math.min(matched, preview.limit) || (!includePending && pending > 0) ||
        Boolean(preview.token) !== (matched > 0) ||
        (matched > 0 && (!Number.isSafeInteger(preview.expires_at) || Number(preview.expires_at) <= 0))) return false;
    const ids = new Set<number>();
    let pendingRows = 0;
    for (const row of rows) {
        if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) ||
            !Number.isSafeInteger(row.hit_at) || row.hit_at <= 0 || !row.rule_name ||
            !Object.hasOwn(reviewLabels, row.review_state)) return false;
        ids.add(row.id);
        if (row.review_state === "pending") pendingRows++;
    }
    return pendingRows <= pending && rows.length - pendingRows <= reviewed;
}

const daySeconds = 86400;

// A business date can end at a DST transition that skips or repeats midnight.
function endOfBusinessDate(day: string, zone: string): number {
    const utc = Date.parse(day + "T00:00:00Z") / 1000;
    let left = utc - daySeconds;
    let right = utc + 2 * daySeconds;
    while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (calendarDay(new Date(middle * 1000), zone) <= day) left = middle + 1;
        else right = middle;
    }
    return left;
}

export function RiskHitCleanup({ close, onDeleted }: { close: () => void; onDeleted: (count: number, skipped: number) => void }) {
    const [zone] = useState(businessTimeZone);
    const today = calendarDay(new Date(), zone);
    const [day, setDay] = useState("");
    const [includePending, setIncludePending] = useState(false);
    const [preview, setPreview] = useState<CleanupPreview | null>(null);
    const [busy, setBusy] = useState<"preview" | "delete" | "retry" | null>(null);
    const [accepted, setAccepted] = useState<CleanupTask | null>(null);
    const taskPath = ops("log/rule-hit/cleanup/status");
    const status = useData<CleanupTask | null>(accepted ? query(taskPath, { id: accepted.id }) : taskPath);
    const task = status.data ?? accepted;
    const active = task?.state === "queued" || task?.state === "running";
    const canPreview = !active && task?.state !== "failed";
    const reported = useRef<number | null>(null);
    const [error, setError] = useState("");
    const inFlight = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (task && active && !accepted) setAccepted(task);
        if (accepted && task?.state === "completed" && reported.current !== task.id) {
            reported.current = task.id;
            onDeleted(task.deleted, task.skipped);
            close();
        }
    }, [task, active, accepted, onDeleted, close]);

    useEffect(() => {
        if (!active || status.loading) return;
        const timer = window.setInterval(() => {
            if (document.visibilityState !== "hidden" && Date.now() >= status.retryAt) status.reload();
        }, status.error ? 10000 : 2500);
        return () => window.clearInterval(timer);
    }, [active, status.loading, status.error, status.retryAt, status.reload]);

    function expire() {
        setPreview(null);
        setError("清理预览已过期，请重新预览。");
    }

    useEffect(() => {
        if (!preview?.expires_at || busy === "delete") return;
        const timer = window.setTimeout(expire, Math.max(0, preview.expires_at * 1000 - Date.now()));
        return () => window.clearTimeout(timer);
    }, [preview, busy]);

    function resetPreview() {
        setError("");
        setPreview(null);
    }

    async function getPreview(event: FormEvent) {
        event.preventDefault();
        if (inFlight.current || !canPreview || status.loading || status.error || !day || day > today || day < "1970-01-01") return;
        inFlight.current = true;
        setBusy("preview");
        resetPreview();
        try {
            const { data } = await request<CleanupPreview>(ops("log/rule-hit/cleanup/preview"), {
                before: endOfBusinessDate(day, zone),
                include_pending: includePending,
            }, { timeoutMs: 120000 });
            if (!hasCompletePreview(data, includePending)) throw new Error("清理预览明细不完整，请刷新页面后重新预览。");
            if (mounted.current) setPreview(data);
        } catch (cause) {
            if (mounted.current) setError((cause as Error).message);
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(null);
        }
    }

    async function execute() {
        if (inFlight.current || !canPreview || status.loading || status.error || !preview?.token || !preview.expires_at) return;
        if (preview.expires_at * 1000 <= Date.now()) { expire(); return; }
        inFlight.current = true;
        setBusy("delete");
        setError("");
        try {
            const { data } = await request<CleanupTask>(
                ops("log/rule-hit/cleanup/execute"), { token: preview.token },
            );
            if (mounted.current) {
                setPreview(null);
                setAccepted(data);
            }
        } catch (cause) {
            if (mounted.current) {
                setPreview(null);
                const problem = cause as Error & { status?: number };
                setError(problem.status === 409 ? "预览已失效，请重新预览。"
                    : `${problem.message}。请核对执行结果后重新预览。`);
                setAccepted(null);
                status.reload();
            }
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(null);
        }
    }

    async function resume() {
        if (!task || task.state !== "failed" || inFlight.current) return;
        inFlight.current = true;
        setBusy("retry");
        resetPreview();
        try {
            const { data } = await request<CleanupTask>(ops("log/rule-hit/cleanup/retry"), { id: task.id });
            if (mounted.current) {
                setAccepted(data);
                status.reload();
            }
        } catch (cause) {
            if (mounted.current) {
                setError((cause as Error).message);
                status.reload();
            }
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(null);
        }
    }

    return <Modal title="一次性清理风控命中" className="admin-detail-dialog" close={close} dismissible={busy !== "delete"} initialFocus='input[type="date"]'>
        <form className="admin-dialog-form pad" onSubmit={getPreview} aria-busy={!!busy} data-saving={busy === "delete" || undefined}>
            {task && <div className="admin-detail-section" role="status">
                <h3>{task.state === "queued" ? "已提交，等待后台处理" : task.state === "running" ? "后台正在清理" :
                    task.state === "failed" ? "清理任务已中断" : "上次清理已完成"}</h3>
                <p>已处理 {task.deleted + task.skipped} / {task.matched} 条，已永久删除 {task.deleted} 条，跳过 {task.skipped} 条。</p>
                {active && <p>关闭窗口后后台将继续清理，可重新打开查看进度。</p>}
                {task.state === "failed" && <button type="button" disabled={!!busy || status.loading} onClick={resume}>继续清理剩余记录</button>}
            </div>}
            {status.error && <div role="alert" className="alert">查询清理任务失败。{status.error} <button type="button" disabled={status.loading} onClick={status.reload}>重试查询</button></div>}
            {canPreview && <>
            <p>从全部风控命中原始记录中，按下列条件预览本次清理范围。列表筛选和勾选仅用于列表操作。</p>
            <label>命中截止日期（含当天）
                <input type="date" required min="1970-01-01" max={today} value={day} disabled={!!busy}
                    aria-describedby="risk-cleanup-zone"
                    onChange={e => { setDay(e.target.value); resetPreview(); }} />
            </label>
            <small id="risk-cleanup-zone">按业务时区 {zone} 计算。选择今天时，范围截至本次预览。</small>
            <label className="risk-hit-selection"><input type="checkbox" checked={includePending} disabled={!!busy}
                onChange={e => { setIncludePending(e.target.checked); resetPreview(); }} />包含待复核记录</label>
            {preview && <div role="status" className="admin-detail-section">
                <p>共匹配 {preview.matched} 条，本次清理范围为全部 {preview.matched} 条。</p>
                <p>已复核 {preview.reviewed} 条，待复核 {preview.pending} 条。</p>
                {preview.matched > preview.rows.length && <p>下方仅展示前 {preview.rows.length} 条供核对。确认一次后，后台将分批处理全部 {preview.matched} 条。</p>}
                {preview.matched === 0 && <p>{!includePending && preview.excluded_pending
                    ? `另有 ${preview.excluded_pending} 条待复核记录。如需纳入，请勾选“包含待复核记录”后重新预览。`
                    : "所选截止日期内没有符合条件的命中记录。"}</p>}
            </div>}
            {preview && preview.rows.length > 0 && <section aria-label="本次清理记录" className="risk-cleanup-records">
                <h3 className="admin-detail-section-head">本次清理记录</h3>
                <AdminPagedTable data={preview.rows} columns={[
                    ["id", "记录 ID", row => `#${row.id}`],
                    ...pendingRiskColumns.filter(([key]) => key === "rule_name" || key === "risk_level"),
                    ["hit_at", "命中时间（业务时区）", row => adminBusinessInstant(row.hit_at, {}, zone)],
                    ["review_state", "复核状态", row => reviewLabels[row.review_state as CleanupRow["review_state"]]],
                ]}/>
                <p>确认后，全部 {preview.matched} 条匹配记录及其复核历史将进入删除任务。</p>
            </section>}
            </>}
            {error && <p className="alert" role="alert">{error}</p>}
            <div className="admin-dialog-actions">
                <button type="button" onClick={close} disabled={busy === "delete"}>{canPreview ? "取消" : "关闭"}</button>
                {canPreview && <button className={preview?.token ? undefined : "primary"} type="submit" disabled={!day || !!busy || status.loading || !!status.error}>
                    {busy === "preview" ? "正在预览…" : "预览清理"}
                </button>}
                {canPreview && preview?.token && <button type="button" className="danger" disabled={!!busy || status.loading || !!status.error} onClick={execute}>
                    {busy === "delete" ? "正在提交…" : "确认永久删除"}
                </button>}
            </div>
        </form>
    </Modal>;
}
