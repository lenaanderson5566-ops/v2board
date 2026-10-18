import { useEffect, useState, useRef, useId, createContext, useContext, Fragment, type ReactNode } from "react";
import { Eye, EyeOff, Check } from "lucide-react";
import { parseDateTimeInput, displayTimeZone } from "../timezone";
import { browserSessionKey } from "../browser-session";
import { e } from "../experience-copy";
import { tx } from "../i18n";
import { ux } from "../ux";
import { inputValue, apiValue } from "../field-values";
import { boot, type Row } from "../api";
import { ModalClose } from "./Modal";

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
    values: Row,
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
    onBusyChange,
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
    onBusyChange?: (busy: boolean) => void;
    onValuesChange?: (values: Row) => void;
    draftKey?: string;
}) {
    const renderField = useContext(EditorFieldContext);
    const draftStorageKey = draftKey
        ? `v2board.draft.${boot.mode}.${browserSessionKey()}.${draftKey}`
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
    const [cleanValue, setCleanValue] = useState(() => JSON.stringify(value));
    const dirty = JSON.stringify(value) !== cleanValue;
    useEffect(() => {
        if (boot.mode !== "admin" || !dirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const submitting = useRef(false);
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
        if (submitting.current) return;
        submitting.current = true;
        setError("");
        setSaved(false);
        setBusy(true);
        onBusyChange?.(true);
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
                body[f.key] = apiValue(f, body[f.key], tx);
                if (f.type === "json" && typeof body[f.key] === "string")
                    body[f.key] = body[f.key].trim()
                        ? JSON.parse(body[f.key])
                        : null;
                if (f.type === "datetime-local")
                    body[f.key] = body[f.key]
                        ? parseDateTimeInput(String(body[f.key]))
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
            setCleanValue(JSON.stringify(draftKey ? initial : value));
            setSaved(true);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            submitting.current = false;
            setBusy(false);
            onBusyChange?.(false);
        }
    }
    return (
        <form
            className="editor"
            data-unsaved={boot.mode === "admin" && dirty ? "true" : undefined}
            onSubmit={save}
            onChange={() => setSaved(false)}
            aria-busy={busy}
        >
            {activeFields.some((field) => field.type === "datetime-local") && (
                <p className="muted">
                    {tx("日期时间按 {{zone}} 输入和显示。", {
                        zone: displayTimeZone(),
                    })}
                </p>
            )}
            <fieldset className="field-grid" disabled={busy}>
                {activeFields.map((f) => {
                    const extension = renderField?.(
                        f,
                        value[f.key],
                        (next) => updateValue(f.key, next),
                        value,
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
                {boot.mode === "admin" && dirty && !saved && (
                    <span className="admin-dirty-note" role="status">
                        {e("adminUnsaved")}
                    </span>
                )}
                {cancel && (
                    <button type="button" disabled={busy} onClick={cancel}>
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
