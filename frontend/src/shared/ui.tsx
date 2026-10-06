import { completePages } from "./paginated-data";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { e } from "./experience-copy";
import { tx, locale } from "./i18n";
import {
    useEffect,
    useState,
    useRef,
    useId,
    createContext,
    useContext,
    Fragment,
    type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ux } from "./ux";
import DOMPurify from "dompurify";
import { renderMarkdown } from "./markdown";
import { moveItem } from "./array-items";
import { inputValue, apiValue } from "./field-values";
const ModalClose = createContext<(() => void) | undefined>(undefined);
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
import { boot, request, readRequest, storageKey, type Row } from "./api";
export function Html({
    value,
    markdown = false,
}: {
    value: unknown;
    markdown?: boolean;
}) {
    return (
        <div
            className="rich-text"
            dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                    markdown ? renderMarkdown(value) : String(value || ""),
                ),
            }}
        />
    );
}
export function useData<T = Row>(path: string, body?: Row, allPages = false) {
    useTranslation();
    const language = locale();
    const serializedBody = body ? JSON.stringify(body) : undefined;
    const [meta, setMeta] = useState<Row | undefined>();
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
        readRequest<T>(
            path,
            serializedBody ? JSON.parse(serializedBody) : undefined,
            version > 0,
        )
            .then(async (r) => {
                if (allPages && Array.isArray(r.data)) {
                    r = (await completePages(
                        r as any,
                        (page) => {
                            const [base, search] = path.split("?");
                            const query = new URLSearchParams(search);
                            query.set("current", String(page));
                            return readRequest<any[]>(
                                `${base}?${query}`,
                                undefined,
                                version > 0,
                            );
                        },
                        () => live,
                    )) as typeof r;
                }
                if (live) {
                    setData(r.data);
                    setTotal(r.total || 0);
                    setMeta(r.meta);
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
    }, [path, version, serializedBody, language, allPages]);
    useEffect(() => {
        if (boot.mode !== "user" || !path) return;
        const refresh = () => setVersion((v) => v + 1);
        const visible = () => {
            if (document.visibilityState === "visible") refresh();
        };
        window.addEventListener("data-changed", refresh);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", visible);
        return () => {
            window.removeEventListener("data-changed", refresh);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", visible);
        };
    }, [path]);
    return {
        data,
        error,
        loading,
        total,
        meta,
        reload: () => setVersion((v) => v + 1),
    };
}
export function State({
    loading,
    error,
    children,
    retry,
    data,
}: {
    data?: unknown;
    loading: boolean;
    error: string;
    children: ReactNode;
    retry?: () => void;
}) {
    if (loading && boot.mode === "user")
        return data != null ? (
            <div className="refreshing-content" aria-busy="true">
                <span className="refresh-status" role="status">
                    {e("refreshing")}
                </span>
                {children}
            </div>
        ) : (
            <WorkspaceSkeleton />
        );
    if (loading)
        return (
            <div className="state">
                <span className="spinner" />
                {tx("正在加载…")}
            </div>
        );
    if (error)
        return (
            <>
                <div className="alert" role="alert">
                    {error}
                    {retry && <button onClick={retry}>{tx("重试")}</button>}
                </div>
                {data != null && children}
            </>
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
    className = "",
}: {
    title?: string;
    children: ReactNode;
    actions?: ReactNode;
    className?: string;
}) {
    return (
        <section className={`panel ${className}`}>
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
    variant,
    wide = false,
    className = "",
}: {
    title: string;
    children: ReactNode;
    close: () => void;
    variant?: "modal" | "drawer";
    wide?: boolean;
    className?: string;
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
            className={
                "overlay" +
                (boot.mode === "admin" &&
                (variant === "drawer" ||
                    (!variant &&
                        /编辑|新建|设置|配置|高级筛选|生成用户/.test(title)))
                    ? " admin-drawer"
                    : "") +
                (wide ? " admin-wide-drawer" : "") +
                " " +
                className
            }
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
                <ModalClose.Provider value={close}>
                    {children}
                </ModalClose.Provider>
            </section>
        </div>,
        document.body,
    );
}
export interface Field {
    columns?: number;
    section?: string;
    unit?: string;
    child?: boolean;
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
    markdown?: boolean;
    scale?: number;
    min?: number;
    max?: number;
    step?: number;
    nullable?: boolean;
    autoComplete?: string;
    placeholder?: string;
    arrayText?: boolean;
    creatable?: boolean;
    required?: boolean;
    options?: [string, string][];
    hint?: string;
}
export type EditorFieldRenderer = (
    field: Field,
    value: unknown,
    onChange: (value: unknown) => void,
) => ReactNode | undefined;
export const EditorFieldContext = createContext<
    EditorFieldRenderer | undefined
>(undefined);
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
    draftKey,
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
    draftKey?: string;
}) {
    const renderField = useContext(EditorFieldContext);
    const draftStorageKey = draftKey
        ? `v2board.draft.${boot.mode}.${localStorage.getItem(storageKey) || ""}.${draftKey}`
        : "";
    const readDraft = (): Row => {
        try {
            return JSON.parse(sessionStorage.getItem(draftStorageKey) || "{}");
        } catch {
            return {};
        }
    };
    const cancel = useContext(ModalClose);
    const formId = useId();
    const initialFields = resolveFields
        ? resolveFields(fields, initial)
        : fields;
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
                    inputValue(
                        initialFields.find((field) => field.key === key),
                        value,
                    ),
                ]),
            ),
            ...(draftKey ? readDraft() : {}),
        })),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [saved, setSaved] = useState(false),
        [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const activeFields = (
        resolveFields ? resolveFields(fields, value) : fields
    ).map((field) =>
        boot.mode === "admin" && field.key === "tags"
            ? {
                  ...field,
                  type: "multiselect" as const,
                  creatable: true,
                  options: (Array.isArray(value.tags) ? value.tags : []).map(
                      (tag) => [String(tag), String(tag)] as [string, string],
                  ),
              }
            : field,
    );
    function updateValue(key: string, next: unknown) {
        if (
            activeFields.find((field) => field.key === key)?.arrayText &&
            typeof next === "string"
        )
            next = next.split(",");
        if (draftKey) {
            try {
                sessionStorage.setItem(
                    draftStorageKey,
                    JSON.stringify(
                        linkValues
                            ? linkValues(key, next, value)
                            : { ...value, [key]: next },
                    ),
                );
            } catch {
                /* Storage may be unavailable. */
            }
        }
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
                if (
                    f.markdown &&
                    f.required &&
                    !String(body[f.key] || "").trim()
                )
                    throw new Error(tx(f.label) + " *");
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
                body[f.key] = apiValue(f, body[f.key]);
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
            if (draftKey) {
                try {
                    sessionStorage.removeItem(draftStorageKey);
                } catch {
                    /* Optional persistence. */
                }
                setValue(initial);
            }
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
                {activeFields.map((f) => {
                    const extension = renderField?.(f, value[f.key], (next) =>
                        updateValue(f.key, next),
                    );
                    return (
                        <Fragment key={f.key}>
                            {f.section && (
                                <div className="field-section">{f.section}</div>
                            )}
                            <label
                                style={
                                    boot.mode === "admin"
                                        ? {
                                              gridColumn: `span ${f.columns || 12}`,
                                          }
                                        : undefined
                                }
                                data-child={f.child || undefined}
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
                                {extension !== undefined ? (
                                    <div inert={busy}>{extension}</div>
                                ) : f.type === "switch" ? (
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={
                                            Number(value[f.key]) === 1
                                        }
                                        aria-label={tx(f.label)}
                                        className="toggle-control"
                                        onClick={() => {
                                            updateValue(
                                                f.key,
                                                Number(value[f.key]) === 1
                                                    ? 0
                                                    : 1,
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
                                        {(f.options || []).map(
                                            ([key, label]) => {
                                                const selected = (
                                                    Array.isArray(value[f.key])
                                                        ? value[f.key]
                                                        : []
                                                ).map(String);
                                                const checked =
                                                    selected.includes(key);
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
                                                                      (
                                                                          v: string,
                                                                      ) =>
                                                                          v !==
                                                                          key,
                                                                  )
                                                                : [
                                                                      ...selected,
                                                                      key,
                                                                  ];
                                                            updateValue(
                                                                f.key,
                                                                next.map(
                                                                    (
                                                                        v: string,
                                                                    ) =>
                                                                        /^\d+$/.test(
                                                                            v,
                                                                        )
                                                                            ? Number(
                                                                                  v,
                                                                              )
                                                                            : v,
                                                                ),
                                                            );
                                                            setSaved(false);
                                                        }}
                                                    >
                                                        <span className="option-check">
                                                            {checked && (
                                                                <Check
                                                                    size={12}
                                                                />
                                                            )}
                                                        </span>
                                                        {label}
                                                    </button>
                                                );
                                            },
                                        )}
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
                                            value[f.key] ??
                                            f.options?.[0]?.[0] ??
                                            ""
                                        }
                                        onChange={(e) =>
                                            updateValue(f.key, e.target.value)
                                        }
                                    >
                                        {value[f.key] != null &&
                                            !f.options?.some(
                                                ([v]) =>
                                                    v === String(value[f.key]),
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
                                ) : f.type === "textarea" ||
                                  f.type === "json" ? (
                                    <textarea
                                        placeholder={f.placeholder}
                                        rows={f.type === "json" ? 6 : 4}
                                        value={
                                            typeof value[f.key] === "object" &&
                                            value[f.key] !== null
                                                ? f.arrayText &&
                                                  Array.isArray(value[f.key])
                                                    ? value[f.key].join(",")
                                                    : JSON.stringify(
                                                          value[f.key],
                                                          null,
                                                          2,
                                                      )
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
                                                f.type === "password" &&
                                                revealed[f.key]
                                                    ? "text"
                                                    : f.type || "text"
                                            }
                                            placeholder={f.placeholder}
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
                                                updateValue(
                                                    f.key,
                                                    e.target.value,
                                                )
                                            }
                                        />
                                        {f.suggestions && (
                                            <datalist id={`${formId}-${f.key}`}>
                                                {f.suggestions.map((text) => (
                                                    <option
                                                        key={text}
                                                        value={text}
                                                    />
                                                ))}
                                            </datalist>
                                        )}
                                        {f.unit && (
                                            <span className="input-unit">
                                                {f.unit}
                                            </span>
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
                                                aria-pressed={Boolean(
                                                    revealed[f.key],
                                                )}
                                                onClick={() =>
                                                    setRevealed({
                                                        ...revealed,
                                                        [f.key]:
                                                            !revealed[f.key],
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
                        </Fragment>
                    );
                })}
            </fieldset>
            {children}
            {error && (
                <div className="alert" role="alert">
                    {error}
                </div>
            )}
            <div className="form-bottom">
                {cancel && (
                    <button type="button" onClick={cancel}>
                        {ux("cancel")}
                    </button>
                )}
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
    sort,
    onSort,
    onReorder,
    compact = false,
}: {
    compact?: boolean;
    data: Row[];
    columns: [string, string, ((row: Row) => ReactNode)?][];
    actions?: (row: Row, context?: boolean) => ReactNode;
    sort?: { key: string; direction: string; fields: string[] };
    onSort?: (key: string, direction: string) => void;
    onReorder?: (data: Row[]) => void | Promise<void>;
}) {
    const [dragged, setDragged] = useState<number | null>(null);
    const [reorderError, setReorderError] = useState("");
    const [reordering, setReordering] = useState(false);
    const [context, setContext] = useState<{
        row: Row;
        x: number;
        y: number;
    } | null>(null);
    const contextMenu = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!context) return;
        const close = (event: MouseEvent) => {
            if (!contextMenu.current?.contains(event.target as Node))
                setContext(null);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setContext(null);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", escape);
        };
    }, [context]);
    if (!data.length && boot.mode !== "admin") return <Empty />;
    return (
        <div
            className={`table-scroll ${compact ? "compact-mobile-table" : ""}`}
        >
            {reorderError && (
                <div className="alert" role="alert">
                    {reorderError}
                </div>
            )}
            <table>
                <thead>
                    <tr>
                        {onReorder && <th>{ux("sort")}</th>}
                        {columns.map(([k, label]) => (
                            <th
                                key={k}
                                aria-sort={
                                    sort?.key === k
                                        ? sort.direction === "ASC"
                                            ? "ascending"
                                            : "descending"
                                        : undefined
                                }
                            >
                                {sort?.fields.includes(k) && onSort ? (
                                    <button
                                        className="table-sort"
                                        onClick={() =>
                                            onSort(
                                                k,
                                                sort.key === k &&
                                                    sort.direction === "ASC"
                                                    ? "DESC"
                                                    : "ASC",
                                            )
                                        }
                                    >
                                        {label}
                                        <span aria-hidden="true">
                                            {sort.key === k
                                                ? sort.direction === "ASC"
                                                    ? " ▲"
                                                    : " ▼"
                                                : " ↕"}
                                        </span>
                                    </button>
                                ) : (
                                    label
                                )}
                            </th>
                        ))}
                        {actions && <th>{tx("操作")}</th>}
                    </tr>
                </thead>
                <tbody>
                    {!data.length && (
                        <tr>
                            <td
                                colSpan={
                                    columns.length +
                                    (actions ? 1 : 0) +
                                    (onReorder ? 1 : 0)
                                }
                            >
                                <Empty />
                            </td>
                        </tr>
                    )}
                    {data.map((r, i) => (
                        <tr
                            key={
                                r.type
                                    ? `${r.type}-${r.id ?? i}`
                                    : (r.id ?? r.trade_no ?? i)
                            }
                            onContextMenu={
                                boot.mode === "admin" && actions
                                    ? (e) => {
                                          e.preventDefault();
                                          setContext({
                                              row: r,
                                              x: Math.min(
                                                  e.clientX,
                                                  window.innerWidth - 220,
                                              ),
                                              y: Math.min(
                                                  e.clientY,
                                                  window.innerHeight - 300,
                                              ),
                                          });
                                      }
                                    : undefined
                            }
                            onDragOver={
                                onReorder
                                    ? (e) => e.preventDefault()
                                    : undefined
                            }
                            onDrop={
                                onReorder
                                    ? async (e) => {
                                          e.preventDefault();
                                          if (
                                              dragged === null ||
                                              dragged === i ||
                                              reordering
                                          )
                                              return;
                                          setReordering(true);
                                          setReorderError("");
                                          try {
                                              await onReorder(
                                                  moveItem(data, dragged, i),
                                              );
                                          } catch (error) {
                                              setReorderError(
                                                  (error as Error).message,
                                              );
                                          } finally {
                                              setDragged(null);
                                              setReordering(false);
                                          }
                                      }
                                    : undefined
                            }
                        >
                            {onReorder && (
                                <td>
                                    <button
                                        type="button"
                                        draggable
                                        disabled={reordering}
                                        aria-label={`排序 ${r.name || r.title || r.id}`}
                                        className="row-drag-handle"
                                        onDragStart={(e) => {
                                            e.dataTransfer.effectAllowed =
                                                "move";
                                            setDragged(i);
                                        }}
                                        onDragEnd={() => setDragged(null)}
                                    >
                                        ☰
                                    </button>
                                </td>
                            )}
                            {columns.map(([k, label, render]) => (
                                <td key={k} data-label={label}>
                                    {render
                                        ? render(r)
                                        : r[k] != null &&
                                            typeof r[k] === "object"
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
            {context &&
                actions &&
                createPortal(
                    <div
                        ref={contextMenu}
                        className="admin-context-menu"
                        role="menu"
                        style={{
                            left: Math.max(0, context.x),
                            top: Math.max(0, context.y),
                        }}
                        onClick={(e) => {
                            if ((e.target as Element).closest("button,a[href]"))
                                setContext(null);
                        }}
                    >
                        {actions(context.row, true)}
                    </div>,
                    document.body,
                )}
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
