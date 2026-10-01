import { useEffect, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { X, Inbox, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { request, type Row } from "./api";
export function Html({ value }: { value: unknown }) {
    return (
        <div
            className="rich-text"
            dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(String(value || "")),
            }}
        />
    );
}
export function useData<T = Row>(path: string, body?: Row) {
    const serializedBody = body ? JSON.stringify(body) : undefined;
    const [data, setData] = useState<T | null>(null),
        [error, setError] = useState(""),
        [loading, setLoading] = useState(true),
        [version, setVersion] = useState(0),
        [total, setTotal] = useState(0);
    useEffect(() => {
        let live = true;
        setLoading(true);
        setError("");
        request<T>(
            path,
            serializedBody ? JSON.parse(serializedBody) : undefined,
        )
            .then((r) => {
                if (live) {
                    setData(r.data);
                    setTotal(r.total || 0);
                }
            })
            .catch((e) => {
                if (live) setError(e.message);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [path, version, serializedBody]);
    return {
        data,
        error,
        loading,
        total,
        reload: () => setVersion((v) => v + 1),
    };
}
export function State({
    loading,
    error,
    children,
    retry,
}: {
    loading: boolean;
    error: string;
    children: ReactNode;
    retry?: () => void;
}) {
    if (loading)
        return (
            <div className="state">
                <span className="spinner" />
                正在加载…
            </div>
        );
    if (error)
        return (
            <div className="alert" role="alert">
                {error}
                {retry && <button onClick={retry}>重试</button>}
            </div>
        );
    return <>{children}</>;
}
export function Empty({ text = "暂无数据" }: { text?: string }) {
    return (
        <div className="state">
            <Inbox size={36} />
            <strong>{text}</strong>
            <span>数据更新后会显示在这里</span>
        </div>
    );
}
export function Panel({
    title,
    children,
    actions,
}: {
    title?: string;
    children: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <section className="panel">
            {(title || actions) && (
                <div className="panel-head">
                    <h2>{title}</h2>
                    <div className="actions">{actions}</div>
                </div>
            )}
            {children}
        </section>
    );
}
export function Modal({
    title,
    children,
    close,
}: {
    title: string;
    children: ReactNode;
    close: () => void;
}) {
    useEffect(() => {
        const fn = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        document.addEventListener("keydown", fn);
        return () => document.removeEventListener("keydown", fn);
    }, [close]);
    return (
        <div
            className="overlay"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) close();
            }}
        >
            <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="panel-head">
                    <h2>{title}</h2>
                    <button
                        className="icon-button"
                        onClick={close}
                        aria-label="关闭"
                    >
                        <X />
                    </button>
                </div>
                {children}
            </section>
        </div>
    );
}
export interface Field {
    key: string;
    label: string;
    type?:
        | "text"
        | "number"
        | "password"
        | "textarea"
        | "json"
        | "select"
        | "datetime-local";
    required?: boolean;
    options?: [string, string][];
    hint?: string;
}
export function Editor({
    fields,
    initial,
    onSave,
    submit = "保存",
    children,
}: {
    fields: Field[];
    initial: Row;
    onSave: (data: Row) => Promise<void>;
    submit?: string;
    children?: ReactNode;
}) {
    const [value, setValue] = useState<Row>(() => ({
            ...Object.fromEntries(
                fields
                    .filter((f) => f.type === "select")
                    .map((f) => [f.key, f.options?.[0]?.[0] ?? ""]),
            ),
            ...Object.fromEntries(
                Object.entries(initial).map(([key, value]) => [
                    key,
                    typeof value === "boolean" ? Number(value) : value,
                ]),
            ),
        })),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false);
    async function save(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            const body = { ...value };
            for (const f of fields) {
                if (!(f.key in body)) continue;
                if (
                    f.type === "select" &&
                    /^-?\d+(\.\d+)?$/.test(String(body[f.key]))
                )
                    body[f.key] = Number(body[f.key]);
                if (f.type === "number")
                    body[f.key] =
                        body[f.key] === "" ? null : Number(body[f.key]);
                if (f.type === "json" && typeof body[f.key] === "string")
                    body[f.key] = body[f.key].trim()
                        ? JSON.parse(body[f.key])
                        : null;
                if (f.type === "datetime-local")
                    body[f.key] = body[f.key]
                        ? Math.floor(new Date(body[f.key]).getTime() / 1000)
                        : null;
            }
            await onSave(body);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <form className="editor" onSubmit={save}>
            <div className="field-grid">
                {fields.map((f) => (
                    <label
                        className={
                            f.type === "textarea" || f.type === "json"
                                ? "wide"
                                : ""
                        }
                        key={f.key}
                    >
                        <span>
                            {f.label}
                            {f.required && " *"}
                        </span>
                        {f.type === "select" ? (
                            <select
                                value={value[f.key] ?? ""}
                                onChange={(e) =>
                                    setValue({
                                        ...value,
                                        [f.key]: e.target.value,
                                    })
                                }
                            >
                                {f.options?.map(([v, label]) => (
                                    <option value={v} key={v}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        ) : f.type === "textarea" || f.type === "json" ? (
                            <textarea
                                rows={f.type === "json" ? 6 : 4}
                                value={
                                    typeof value[f.key] === "object" &&
                                    value[f.key] !== null
                                        ? JSON.stringify(value[f.key], null, 2)
                                        : (value[f.key] ?? "")
                                }
                                required={f.required}
                                onChange={(e) =>
                                    setValue({
                                        ...value,
                                        [f.key]: e.target.value,
                                    })
                                }
                            />
                        ) : (
                            <input
                                type={f.type || "text"}
                                step={f.type === "number" ? "any" : undefined}
                                value={value[f.key] ?? ""}
                                required={f.required}
                                onChange={(e) =>
                                    setValue({
                                        ...value,
                                        [f.key]: e.target.value,
                                    })
                                }
                            />
                        )}{" "}
                        {f.hint && <small>{f.hint}</small>}
                    </label>
                ))}
            </div>
            {children}
            {error && (
                <div className="alert" role="alert">
                    {error}
                </div>
            )}
            <div className="form-bottom">
                <button className="primary" disabled={busy}>
                    {busy ? "提交中…" : submit}
                </button>
            </div>
        </form>
    );
}
export function Pager({
    page,
    total,
    size = 20,
    onChange,
}: {
    page: number;
    total: number;
    size?: number;
    onChange: (page: number) => void;
}) {
    return (
        <div className="pager">
            <span>
                共 {total} 条 · 第 {page} 页
            </span>
            <button
                disabled={page === 1}
                onClick={() => onChange(page - 1)}
                aria-label="上一页"
            >
                <ChevronLeft size={16} />
            </button>
            <button
                disabled={page * size >= total}
                onClick={() => onChange(page + 1)}
                aria-label="下一页"
            >
                <ChevronRight size={16} />
            </button>
        </div>
    );
}
export function Reload({ onClick }: { onClick: () => void }) {
    return (
        <button onClick={onClick}>
            <RefreshCw size={15} />
            刷新
        </button>
    );
}
export function Table({
    data,
    columns,
    actions,
}: {
    data: Row[];
    columns: [string, string, ((row: Row) => ReactNode)?][];
    actions?: (row: Row) => ReactNode;
}) {
    if (!data.length) return <Empty />;
    return (
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        {columns.map(([k, label]) => (
                            <th key={k}>{label}</th>
                        ))}
                        {actions && <th>操作</th>}
                    </tr>
                </thead>
                <tbody>
                    {data.map((r, i) => (
                        <tr key={r.id ?? r.trade_no ?? i}>
                            {columns.map(([k, , render]) => (
                                <td key={k}>
                                    {render
                                        ? render(r)
                                        : typeof r[k] === "object"
                                          ? JSON.stringify(r[k])
                                          : String(r[k] ?? "—")}
                                </td>
                            ))}
                            {actions && (
                                <td>
                                    <div className="actions">{actions(r)}</div>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
export function Metric({
    label,
    value,
    detail,
}: {
    label: string;
    value: ReactNode;
    detail?: string;
}) {
    return (
        <div className="metric">
            <span>{label}</span>
            <strong>{value}</strong>
            {detail && <small>{detail}</small>}
        </div>
    );
}
