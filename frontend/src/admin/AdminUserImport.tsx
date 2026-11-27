import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { admin, money, request } from "../shared/api";
import { formatInstant } from "../shared/timezone";
import { Modal, Table } from "../shared/ui";
import { AdminDetails } from "./admin-section";

const maxFileBytes = 5 * 1024 * 1024;
const uploadOptions = { cache: "no-store", redirect: "error" } as const;

const stateLabels = {
    ready: "可导入",
    existing_email: "邮箱已存在",
    already_imported: "来源记录已导入",
    needs_review: "待复核",
    conflict: "冲突",
};

const reasonLabels = new Map(Object.entries({
    pre_cutoff_entitlement_unknown: "分界时的剩余权益待核实",
    historical_entitlement_unverified: "分界时的剩余权益待核实",
    multi_currency_balance: "涉及两种币种",
    mixed_currency: "涉及两种币种",
    negative_source_balance: "原余额为负",
    wallet_balance_unverified: "原站钱包余额待核对",
    unverified_post_cutoff_payment: "分界后的付款待对账",
    payment_unverified: "付款待对账",
    refund_reconciliation: "退款或套餐折抵待核对",
    wallet_deduction_reconciliation: "钱包抵扣待核对",
    credentials_unusable: "密码格式需核对",
    password_hash_cost_out_of_range: "密码哈希的计算成本超出允许范围",
    source_account_ineligible: "原站账号的状态或权限需核对",
    duplicate_source_user: "文件内来源用户编号重复",
    duplicate_file_email: "文件内邮箱重复",
    ambiguous_target_email: "目标站存在多个邮箱匹配项",
    database_email_conflict: "与目标站邮箱冲突",
    preview_changed: "账号状态已变化",
}));

type ImportRow = {
    source_user_id: number;
    email: string;
    currency: "CNY" | "USD";
    balance: number;
    state: keyof typeof stateLabels;
    review_reasons: string[];
};

type ImportTotals = Record<"CNY" | "USD", number>;

type ImportPreview = {
    source_site: string;
    snapshot_at: number;
    cutoff_at: number;
    total: number;
    ready: number;
    existing_email: number;
    already_imported: number;
    needs_review: number;
    conflicts: number;
    totals: ImportTotals;
    rows: ImportRow[];
    preview_token: string;
};

type ImportOutcome = { created: number; skipped: number; totals: ImportTotals };

export function AdminUserImport({ close, onComplete }: { close: () => void; onComplete: () => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [remarks, setRemarks] = useState("");
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
    const [error, setError] = useState("");
    const requestPending = useRef(false);

    function selectFile(event: ChangeEvent<HTMLInputElement>) {
        if (requestPending.current) return;
        const selected = event.currentTarget.files?.[0] || null;
        setPreview(null);
        setConfirmed(false);
        if (selected && (selected.size === 0 || selected.size > maxFileBytes)) {
            event.currentTarget.value = "";
            setFile(null);
            setError("请选择非空且不超过 5 MiB 的迁移文件。");
            return;
        }
        setFile(selected);
        setError("");
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!file || requestPending.current || (preview && (!confirmed || preview.ready === 0))) return;

        const body = new FormData();
        body.append("file", file);
        requestPending.current = true;
        setBusy(preview ? "apply" : "preview");
        setConfirmed(false);
        setError("");
        try {
            if (preview) {
                body.append("preview_token", preview.preview_token);
                const trimmedRemarks = remarks.trim();
                if (trimmedRemarks) body.append("remarks", trimmedRemarks);
                const { data } = await request<ImportOutcome>(admin("user/importApply"), body, { ...uploadOptions, timeoutMs: 120000 });
                if (![data?.created, data?.skipped, data?.totals?.CNY, data?.totals?.USD]
                    .every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
                    throw new Error("服务端未返回导入结果。");
                }
                setOutcome({ created: data.created, skipped: data.skipped, totals: data.totals });
                setFile(null);
                setRemarks("");
                setPreview(null);
                onComplete();
            } else {
                const { data } = await request<ImportPreview>(admin("user/importPreview"), body, uploadOptions);
                if (typeof data?.preview_token !== "string" || !data.preview_token) {
                    throw new Error("服务端未返回有效的预览。");
                }
                setPreview(data);
            }
        } catch (cause) {
            const failure = cause as { code?: string; status?: number; message?: string } | null;
            if (preview && failure?.status === 422) {
                setError(failure.message || "请检查导入内容后重试。");
            } else if (preview) {
                setPreview(null);
                if (failure?.code === "RECENT_LOGIN_REQUIRED") {
                    setError("请重新登录后台，并在 5 分钟内重新预览并确认导入。");
                } else {
                    setError(failure?.status === 409
                        ? "导入预览已失效，请重新预览后确认。"
                        : "暂时无法确认导入结果，请重新预览核对已导入的记录。");
                }
            } else {
                setError(failure?.status === 413
                    ? "文件超过站点上传限制。"
                    : failure?.message || "无法预览导入，请稍后重试。");
            }
        } finally {
            requestPending.current = false;
            setBusy(null);
        }
    }

    return <Modal title="批量导入用户" className="admin-detail-dialog" close={close} dismissible={!busy} initialFocus='input[type="file"]'>
        {outcome ? <div className="pad admin-dialog-form">
            <p role="status">导入完成。已创建 {outcome.created} 个账号，跳过 {outcome.skipped} 个账号。</p>
            <AdminDetails className="admin-detail-grid" items={[
                { label: "实际入账人民币", value: money(outcome.totals.CNY, "CNY") },
                { label: "实际入账美元", value: money(outcome.totals.USD, "USD") },
            ]} />
            <div className="admin-dialog-actions">
                <button type="button" onClick={close} autoFocus>完成</button>
            </div>
        </div> : <form className="pad admin-detail-stack admin-dialog-form" aria-busy={!!busy} onSubmit={submit}>
            <label>
                迁移 JSON 文件
                <input type="file" accept=".json,application/json" disabled={!!busy} onChange={selectFile} />
            </label>
            <label>
                导入备注（选填）
                <input value={remarks} maxLength={255} placeholder="留空则不填写备注" disabled={!!busy} onChange={event => {
                    setRemarks(event.target.value);
                    setConfirmed(false);
                }} />
            </label>
            <p className="muted">先预览查重和余额，再确认导入。目标站已有邮箱的账号及待复核账号会整笔跳过。</p>
            <p className="muted">请在登录后台后 5 分钟内确认导入。文件含用户邮箱和密码哈希，请在受信任的设备上操作并妥善保管文件。</p>
            {preview && <>
                <AdminDetails className="admin-detail-grid" items={[
                    { label: "来源站点", value: preview.source_site },
                    { label: "来源快照时间", value: formatInstant(preview.snapshot_at, {}, "Asia/Shanghai") },
                    { label: "权益折算分界", value: formatInstant(preview.cutoff_at, {}, "Asia/Shanghai") },
                    { label: "文件账号数", value: preview.total },
                    { label: "可导入", value: preview.ready },
                    { label: "邮箱已存在", value: preview.existing_email },
                    { label: "来源记录已导入", value: preview.already_imported },
                    { label: "待复核", value: preview.needs_review },
                    { label: "冲突", value: preview.conflicts },
                    { label: "拟入账人民币", value: money(preview.totals.CNY, "CNY") },
                    { label: "拟入账美元", value: money(preview.totals.USD, "USD") },
                ]} />
                {preview.rows.length > 0 && <details>
                    <summary>查看预览明细（{preview.rows.length < preview.total
                        ? `显示 ${preview.rows.length} 条，共 ${preview.total} 条`
                        : `${preview.rows.length} 条`}）</summary>
                    <Table data={preview.rows} columns={[
                        ["source_user_id", "原用户 ID"],
                        ["email", "邮箱"],
                        ["state", "结果", row => stateLabels[row.state as ImportRow["state"]] || "待核对"],
                        ["balance", "拟入账", row => row.state === "ready" ? money(row.balance, row.currency) : "—"],
                        ["review_reasons", "待核对事项", row => row.review_reasons.length > 0
                            ? row.review_reasons.map((reason: string) => reasonLabels.get(reason) || "其他事项需复核").join("、")
                            : "—"],
                    ]} />
                </details>}
                {preview.ready > 0 ? <label>
                    <input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} />
                    确认创建可导入账号并按预览金额入账
                </label> : <p role="status">当前文件没有可导入账号。</p>}
            </>}
            {error && <p role="alert" className="alert">{error}</p>}
            <div className="admin-dialog-actions">
                <button type="button" disabled={!!busy} onClick={close}>取消</button>
                {preview && <button type="button" disabled={!!busy} onClick={() => {
                    setPreview(null);
                    setConfirmed(false);
                    setError("");
                }}>重新核对</button>}
                <button type="submit" className="primary" disabled={!file || !!busy || !!preview && (!confirmed || preview.ready === 0)}>
                    {busy === "preview" ? "正在预览…" : busy === "apply" ? "正在导入…" : preview ? "确认导入" : "预览导入"}
                </button>
            </div>
        </form>}
    </Modal>;
}
