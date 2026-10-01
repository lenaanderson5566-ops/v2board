import { tx, locale } from "./i18n";
import { useEffect, useState, useRef, useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ux } from "./ux";
import DOMPurify from "dompurify";
import {
    X,
    Inbox,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    Check,
} from "lucide-react";
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
    useTranslation();
    const language = locale();
    const serializedBody = body ? JSON.stringify(body) : undefined;
    const [data, setData] = useState<T | null>(null),
        [error, setError] = useState(""),
        [loading, setLoading] = useState(true),
        [version, setVersion] = useState(0),
        [total, setTotal] = useState(0);
    useEffect(() => {
        let live = true;
        if (!path) {
            setLoading(false);
            setData(null);
            setError("");
            return;
        }
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
    }, [path, version, serializedBody, language]);
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
                {tx("正在加载…")}
            </div>
        );
    if (error)
        return (
            <div className="alert" role="alert">
                {error}
                {retry && <button onClick={retry}>{tx("重试")}</button>}
            </div>
        );
    return <>{children}</>;
}
export function Empty({ text = tx("暂无数据") }: { text?: string }) {
    return (
        <div className="state">
            <Inbox size={36} />
            <strong>{text}</strong>
            <span>{tx("数据更新后会显示在这里")}</span>
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
    const dialog = useRef<HTMLElement>(null);
    const closeRef = useRef(close);
    closeRef.current = close;
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const root = document.getElementById("root");
        const previousInert = root?.inert;
        if (root) root.inert = true;
        dialog.current
            ?.querySelector<HTMLElement>(
                "button, input, select, textarea, a[href]",
            )
            ?.focus();
        const fn = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeRef.current();
            if (e.key === "Tab") {
                const items = [
                    ...(dialog.current?.querySelectorAll<HTMLElement>(
                        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
                    ) || []),
                ];
                const first = items[0],
                    last = items.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener("keydown", fn);
        return () => {
            document.removeEventListener("keydown", fn);
            document.body.style.overflow = previousOverflow;
            if (root) root.inert = previousInert || false;
            previous?.focus();
        };
    }, []);
    return createPortal(
        <div
            className="overlay"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) close();
            }}
        >
            <section
                className="modal"
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="panel-head">
                    <h2>{title}</h2>
                    <button
                        className="icon-button"
                        onClick={close}
                        aria-label={tx("关闭")}
                    >
                        <X />
                    </button>
                </div>
                {children}
            </section>
        </div>,
        document.body,
    );
}
export interface Field {
    suggestions?: string[];
    key: string;
    label: string;
    type?:
        | "text"
        | "number"
        | "password"
        | "textarea"
        | "json"
        | "select"
        | "datetime-local"
        | "switch"
        | "multiselect"
        | "email"
        | "url";
    min?: number;
    max?: number;
    step?: number;
    nullable?: boolean;
    autoComplete?: string;
    required?: boolean;
    options?: [string, string][];
    hint?: string;
}
export function Editor({
    fields,
    initial,
    onSave,
    submit = tx("保存"),
    children,
    resolveFields,
    linkValues,
    validate,
    onDirty,
    onValuesChange,
}: {
    fields: Field[];
    initial: Row;
    onSave: (data: Row) => Promise<void>;
    submit?: string;
    children?: ReactNode;
    resolveFields?: (fields: Field[], values: Row) => Field[];
    linkValues?: (key: string, next: unknown, values: Row) => Row;
    validate?: (values: Row) => string | undefined;
    onDirty?: () => void;
    onValuesChange?: (values: Row) => void;
}) {
    const formId = useId();
    const [value, setValue] = useState<Row>(() => ({
            ...Object.fromEntries(
                fields
                    .filter((f) =>
                        ["select", "switch", "multiselect"].includes(
                            f.type || "",
                        ),
                    )
                    .map((f) => [
                        f.key,
                        f.type === "switch"
                            ? 0
                            : f.type === "multiselect"
                              ? []
                              : (f.options?.[0]?.[0] ?? ""),
                    ]),
            ),
            ...Object.fromEntries(
                Object.entries(initial).map(([key, value]) => [
                    key,
                    typeof value === "boolean" ? Number(value) : value,
                ]),
            ),
        })),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [saved, setSaved] = useState(false),
        [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const activeFields = resolveFields ? resolveFields(fields, value) : fields;
    function updateValue(key: string, next: unknown) {
        onDirty?.();
        onValuesChange?.(
            linkValues
                ? linkValues(key, next, value)
                : { ...value, [key]: next },
        );
        setValue((current) =>
            linkValues
                ? linkValues(key, next, current)
                : { ...current, [key]: next },
        );
        setSaved(false);
        setError("");
    }
    async function save(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setSaved(false);
        setBusy(true);
        try {
            const body = { ...value };
            for (const field of fields)
                if (!activeFields.some((f) => f.key === field.key))
                    delete body[field.key];
            const validationError = validate?.(value);
            if (validationError) throw new Error(validationError);
            for (const f of activeFields) {
                if (f.type === "select" && body[f.key] == null && !f.nullable)
                    body[f.key] = f.options?.[0]?.[0] ?? "";
                if (f.type === "switch" && body[f.key] == null) body[f.key] = 0;
                if (
                    f.type === "multiselect" &&
                    f.required &&
                    !body[f.key]?.length
                )
                    throw new Error(tx(f.label) + " *");
                if (!(f.key in body)) {
                    if (f.type === "select")
                        body[f.key] = f.options?.[0]?.[0] ?? "";
                    else if (f.type === "switch") body[f.key] = 0;
                    else continue;
                }
                if (f.type === "select" && f.nullable && body[f.key] === "")
                    body[f.key] = null;
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
            setSaved(true);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <form
            className="editor"
            onSubmit={save}
            onChange={() => setSaved(false)}
            aria-busy={busy}
        >
            <fieldset className="field-grid" disabled={busy}>
                {activeFields.map((f) => (
                    <label
                        className={
                            f.type === "textarea" ||
                            f.type === "json" ||
                            f.type === "multiselect"
                                ? "wide"
                                : ""
                        }
                        key={f.key}
                    >
                        <span>
                            {tx(f.label)}
                            {f.required && " *"}
                        </span>
                        {f.type === "switch" ? (
                            <button
                                type="button"
                                role="switch"
                                aria-checked={Number(value[f.key]) === 1}
                                aria-label={tx(f.label)}
                                className="toggle-control"
                                onClick={() => {
                                    updateValue(
                                        f.key,
                                        Number(value[f.key]) === 1 ? 0 : 1,
                                    );
                                    setSaved(false);
                                }}
                            >
                                <span className="toggle-track">
                                    <i />
                                </span>
                                <span>
                                    {tx(
                                        Number(value[f.key]) === 1
                                            ? "开启"
                                            : "关闭",
                                    )}
                                </span>
                            </button>
                        ) : f.type === "multiselect" ? (
                            <div
                                className="option-group"
                                role="group"
                                aria-label={tx(f.label)}
                            >
                                {(f.options || []).map(([key, label]) => {
                                    const selected = (
                                        Array.isArray(value[f.key])
                                            ? value[f.key]
                                            : []
                                    ).map(String);
                                    const checked = selected.includes(key);
                                    return (
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={checked}
                                            className={
                                                checked
                                                    ? "option-item selected"
                                                    : "option-item"
                                            }
                                            key={key}
                                            onClick={() => {
                                                const next = checked
                                                    ? selected.filter(
                                                          (v: string) =>
                                                              v !== key,
                                                      )
                                                    : [...selected, key];
                                                updateValue(
                                                    f.key,
                                                    next.map((v: string) =>
                                                        /^\d+$/.test(v)
                                                            ? Number(v)
                                                            : v,
                                                    ),
                                                );
                                                setSaved(false);
                                            }}
                                        >
                                            <span className="option-check">
                                                {checked && <Check size={12} />}
                                            </span>
                                            {label}
                                        </button>
                                    );
                                })}
                                {!f.options?.length && (
                                    <small>{ux("noOptions")}</small>
                                )}
                                {f.options?.length ? (
                                    <button
                                        type="button"
                                        className="option-clear"
                                        onClick={() => {
                                            updateValue(f.key, []);
                                            setSaved(false);
                                        }}
                                    >
                                        {ux("clear")}
                                    </button>
                                ) : null}
                            </div>
                        ) : f.type === "select" ? (
                            <select
                                required={f.required}
                                value={
                                    value[f.key] ?? f.options?.[0]?.[0] ?? ""
                                }
                                onChange={(e) =>
                                    updateValue(f.key, e.target.value)
                                }
                            >
                                {value[f.key] != null &&
                                    !f.options?.some(
                                        ([v]) => v === String(value[f.key]),
                                    ) && (
                                        <option value={value[f.key]}>
                                            {String(value[f.key])}
                                        </option>
                                    )}
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
                                    updateValue(f.key, e.target.value)
                                }
                            />
                        ) : (
                            <div
                                className={
                                    f.type === "password"
                                        ? "password-control"
                                        : "input-control"
                                }
                            >
                                <input
                                    aria-label={tx(f.label)}
                                    list={
                                        f.suggestions
                                            ? `${formId}-${f.key}`
                                            : undefined
                                    }
                                    type={
                                        f.type === "password" && revealed[f.key]
                                            ? "text"
                                            : f.type || "text"
                                    }
                                    autoComplete={
                                        f.autoComplete ??
                                        (f.type === "password"
                                            ? f.key.includes("old")
                                                ? "current-password"
                                                : "new-password"
                                            : f.type === "email"
                                              ? "email"
                                              : undefined)
                                    }
                                    step={
                                        f.step ??
                                        (f.type === "number"
                                            ? "any"
                                            : undefined)
                                    }
                                    min={f.min}
                                    max={f.max}
                                    value={value[f.key] ?? ""}
                                    required={f.required}
                                    onChange={(e) =>
                                        updateValue(f.key, e.target.value)
                                    }
                                />
                                {f.suggestions && (
                                    <datalist id={`${formId}-${f.key}`}>
                                        {f.suggestions.map((text) => (
                                            <option key={text} value={text} />
                                        ))}
                                    </datalist>
                                )}
                                {f.type === "password" && (
                                    <button
                                        type="button"
                                        className="icon-button"
                                        aria-label={ux(
                                            revealed[f.key]
                                                ? "hidePassword"
                                                : "showPassword",
                                        )}
                                        aria-pressed={Boolean(revealed[f.key])}
                                        onClick={() =>
                                            setRevealed({
                                                ...revealed,
                                                [f.key]: !revealed[f.key],
                                            })
                                        }
                                    >
                                        {revealed[f.key] ? (
                                            <EyeOff size={17} />
                                        ) : (
                                            <Eye size={17} />
                                        )}
                                    </button>
                                )}
                            </div>
                        )}{" "}
                        {f.hint && <small>{f.hint}</small>}
                    </label>
                ))}
            </fieldset>
            {children}
            {error && (
                <div className="alert" role="alert">
                    {error}
                </div>
            )}
            <div className="form-bottom">
                {saved && (
                    <span className="save-feedback" role="status">
                        <Check size={15} />
                        {ux("saved")}
                    </span>
                )}
                <button className="primary" disabled={busy}>
                    {busy ? tx("提交中…") : submit}
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
                {tx("共 {{total}} 条 · 第 {{page}} 页", { total, page })}
            </span>
            <button
                disabled={page === 1}
                onClick={() => onChange(page - 1)}
                aria-label={tx("上一页")}
            >
                <ChevronLeft size={16} />
            </button>
            <button
                disabled={page * size >= total}
                onClick={() => onChange(page + 1)}
                aria-label={tx("下一页")}
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
            {tx("刷新")}
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
                        {actions && <th>{tx("操作")}</th>}
                    </tr>
                </thead>
                <tbody>
                    {data.map((r, i) => (
                        <tr key={r.id ?? r.trade_no ?? i}>
                            {columns.map(([k, label, render]) => (
                                <td key={k} data-label={label}>
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
