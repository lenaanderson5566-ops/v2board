import { useEffect, useRef, useState, type FormEvent } from "react";
import { ops, request } from "../shared/api";
import { businessTimeZone, calendarDay } from "../shared/timezone";
import { Modal } from "../shared/ui";

interface CleanupPreview {
    matched: number;
    reviewed: number;
    pending: number;
    limit: number;
    token: string | null;
    expires_at: number | null;
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
    const [busy, setBusy] = useState<"preview" | "delete" | null>(null);
    const [error, setError] = useState("");
    const inFlight = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

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
        if (inFlight.current || !day || day > today || day < "1970-01-01") return;
        inFlight.current = true;
        setBusy("preview");
        resetPreview();
        try {
            const { data } = await request<CleanupPreview>(ops("log/rule-hit/cleanup/preview"), {
                before: endOfBusinessDate(day, zone),
                include_pending: includePending,
            });
            if (mounted.current) setPreview(data);
        } catch (cause) {
            if (mounted.current) setError((cause as Error).message);
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(null);
        }
    }

    async function execute() {
        if (inFlight.current || !preview?.token || !preview.expires_at) return;
        if (preview.expires_at * 1000 <= Date.now()) { expire(); return; }
        inFlight.current = true;
        setBusy("delete");
        setError("");
        try {
            const { data } = await request<{ deleted: number; skipped: number }>(
                ops("log/rule-hit/cleanup/execute"), { token: preview.token },
            );
            if (mounted.current) onDeleted(data.deleted, data.skipped);
        } catch (cause) {
            if (mounted.current) {
                setPreview(null);
                const problem = cause as Error & { status?: number };
                setError(problem.status === 409 ? "预览已失效，请重新预览。"
                    : `${problem.message}。请核对执行结果后重新预览。`);
            }
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(null);
        }
    }

    return <Modal title="一次性清理风控命中" close={close} dismissible={busy !== "delete"} initialFocus='input[type="date"]'>
        <form className="admin-dialog-form pad" onSubmit={getPreview} aria-busy={!!busy} data-saving={busy === "delete" || undefined}>
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
                <p>共匹配 {preview.matched} 条，本次清理 {preview.reviewed + preview.pending} 条。</p>
                <p>已复核 {preview.reviewed} 条，待复核 {preview.pending} 条。</p>
                {preview.matched > preview.reviewed + preview.pending && <p>每次最多 {preview.limit} 条。其余记录需另行预览和确认。</p>}
                {preview.token && <p>确认后将永久删除本批记录及其中的复核历史。</p>}
            </div>}
            {error && <p className="alert" role="alert">{error}</p>}
            <div className="admin-dialog-actions">
                <button type="button" onClick={close} disabled={busy === "delete"}>取消</button>
                <button className={preview?.token ? undefined : "primary"} type="submit" disabled={!day || !!busy}>
                    {busy === "preview" ? "正在预览…" : "预览清理"}
                </button>
                {preview?.token && <button type="button" className="danger" disabled={!!busy} onClick={execute}>
                    {busy === "delete" ? "正在删除…" : "确认永久删除"}
                </button>}
            </div>
        </form>
    </Modal>;
}
