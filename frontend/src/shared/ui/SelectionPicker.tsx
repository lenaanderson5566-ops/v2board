import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Modal } from "./Modal";
import { tx } from "../i18n";
import "./selection-picker.css";

export type SelectionOption = {
    value: string;
    label: string;
    description?: ReactNode;
    searchText?: string;
    lang?: string;
    disabled?: boolean;
};

export function SelectionPicker({
    id,
    label,
    value,
    options,
    onChange,
    disabled = false,
    search,
    unavailableLabel,
    onOpenChange,
    preview,
}: {
    id?: string;
    label: string;
    value: string;
    options: SelectionOption[];
    onChange: (value: string) => void | Promise<void>;
    disabled?: boolean;
    search?: { label: string; placeholder: string; empty: string };
    unavailableLabel?: string;
    onOpenChange?: (open: boolean) => void;
    preview?: (value: string) => ReactNode;
}) {
    const group = useId();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const saving = useRef(false);
    const list = useRef<HTMLDivElement>(null);
    const selected = options.find(
        (option) => option.value === value && !option.disabled,
    );
    const candidate = options.find(
        (option) => option.value === draft && !option.disabled,
    );
    function close() {
        if (saving.current) return;
        setOpen(false);
        onOpenChange?.(false);
    }
    useEffect(() => {
        if (open)
            list.current
                ?.querySelector("input:checked")
                ?.scrollIntoView?.({ block: "nearest" });
    }, [open]);
    const normalized = query.trim().toLocaleLowerCase();
    const matches = options.filter((option) =>
        `${option.label} ${option.searchText || ""}`
            .toLocaleLowerCase()
            .includes(normalized),
    );
    function renderOption(option: SelectionOption) {
        return (
            <label
                key={option.value}
                className={`selection-option${draft === option.value ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`}
            >
                <input
                    type="radio"
                    name={group}
                    value={option.value}
                    checked={draft === option.value}
                    disabled={busy || disabled || option.disabled}
                    onChange={() => {
                        setDraft(option.value);
                        setError("");
                    }}
                />
                <span>
                    <span className="selection-option-title" lang={option.lang}>
                        <bdi>{option.label}</bdi>
                    </span>
                    {option.description && <small>{option.description}</small>}
                </span>
            </label>
        );
    }
    return (
        <>
            <button
                type="button"
                id={id}
                className="selection-trigger"
                aria-label={label}
                aria-describedby={`${group}-value`}
                aria-haspopup="dialog"
                aria-expanded={open}
                disabled={disabled || busy}
                onClick={() => {
                    setDraft(value);
                    setQuery("");
                    setError("");
                    setOpen(true);
                    onOpenChange?.(true);
                }}
            >
                <span id={`${group}-value`} lang={selected?.lang}>
                    <bdi>{selected?.label || label}</bdi>
                </span>
                <ChevronDown size={18} aria-hidden="true" />
            </button>
            {open && (
                <Modal
                    title={label}
                    close={close}
                    dismissible={!busy}
                    className="selection-panel"
                    initialFocus={
                        search
                            ? 'input[type="search"]'
                            : "input:checked:not(:disabled)"
                    }
                >
                    {search && (
                        <div className="selection-search">
                            <input
                                type="search"
                                aria-label={search.label}
                                placeholder={search.placeholder}
                                value={query}
                                disabled={busy}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                            />
                        </div>
                    )}
                    <div
                        className="selection-options"
                        ref={list}
                        role="radiogroup"
                        aria-label={label}
                    >
                        {matches
                            .filter((option) => !option.disabled)
                            .map(renderOption)}
                        {matches.some((option) => option.disabled) && (
                            <details className="selection-unavailable">
                                <summary>
                                    {unavailableLabel || tx("暂不可用")}
                                </summary>
                                {matches
                                    .filter((option) => option.disabled)
                                    .map(renderOption)}
                            </details>
                        )}
                        {!matches.length && search && (
                            <p role="status">{search.empty}</p>
                        )}
                    </div>
                    {preview && (
                        <div className="selection-preview" aria-live="polite">
                            {preview(draft)}
                        </div>
                    )}
                    {error && (
                        <p className="alert selection-error" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="selection-actions">
                        <button type="button" disabled={busy} onClick={close}>
                            {tx("取消")}
                        </button>
                        <button
                            type="button"
                            className="primary"
                            disabled={busy || disabled || !candidate}
                            aria-busy={busy}
                            onClick={async () => {
                                if (saving.current || !candidate) return;
                                if (draft === value) {
                                    close();
                                    return;
                                }
                                saving.current = true;
                                setBusy(true);
                                setError("");
                                try {
                                    await onChange(draft);
                                    saving.current = false;
                                    close();
                                } catch (reason) {
                                    setError((reason as Error).message);
                                } finally {
                                    saving.current = false;
                                    setBusy(false);
                                }
                            }}
                        >
                            {tx(busy ? "提交中…" : "确认选择")}
                        </button>
                    </div>
                </Modal>
            )}
        </>
    );
}
