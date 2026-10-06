import { useEffect, useId, useRef, useState } from "react";
import {
    locationOptions,
    optionsForCountry,
    resolveLocation,
} from "./node-location-options";

export function AdminCitySelect({
    label,
    value,
    region,
    onChange,
}: {
    label: string;
    value: unknown;
    region: unknown;
    onChange: (value: string) => void;
}) {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const code = String(value ?? "");
    const selected = locationOptions.find((option) => option.code === code);
    const matches = optionsForCountry(region).filter((option) =>
        option.search.includes(query.trim().toLowerCase()),
    );
    const close = () => {
        setOpen(false);
        setQuery("");
        setActive(0);
    };
    const select = (next: string) => {
        onChange(next);
        input.current?.focus();
        close();
    };
    useEffect(() => {
        if (open)
            document
                .getElementById(`${id}-${active}`)
                ?.scrollIntoView?.({ block: "nearest" });
    }, [open, active, query, id]);
    useEffect(() => {
        close();
    }, [region]);
    return (
        <div
            className="admin-multiselect admin-region-select"
            onBlur={(event) => {
                if (
                    !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                    )
                )
                    close();
            }}
        >
            <div className="admin-select-control">
                <input
                    ref={input}
                    role="combobox"
                    aria-label={label}
                    autoComplete="off"
                    aria-expanded={open}
                    aria-controls={id}
                    aria-autocomplete="list"
                    aria-activedescendant={
                        open && matches[active] ? `${id}-${active}` : undefined
                    }
                    placeholder="检索州、省或城市名称"
                    value={open ? query : (selected?.label ?? code)}
                    onFocus={() => setOpen(true)}
                    onClick={() => setOpen(true)}
                    onChange={(event) => {
                        const text = event.target.value;
                        setQuery(text);
                        setActive(0);
                        setOpen(true);
                        onChange(resolveLocation(text, region) ?? text);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            close();
                        }
                        if (
                            event.key === "ArrowDown" ||
                            event.key === "ArrowUp"
                        ) {
                            event.preventDefault();
                            setOpen(true);
                            setActive(
                                open
                                    ? Math.max(
                                          0,
                                          Math.min(
                                              matches.length - 1,
                                              active +
                                                  (event.key === "ArrowDown"
                                                      ? 1
                                                      : -1),
                                          ),
                                      )
                                    : 0,
                            );
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            if (open && matches[active])
                                select(matches[active].code);
                            else close();
                        }
                    }}
                />
                <button
                    type="button"
                    aria-label={`清空 ${label}`}
                    onClick={() => select("")}
                >
                    ×
                </button>
                <button
                    type="button"
                    aria-label={`展开 ${label}`}
                    onClick={() => {
                        if (open) close();
                        else {
                            input.current?.focus();
                            setOpen(true);
                        }
                    }}
                >
                    ⌄
                </button>
            </div>
            {open && (
                <div
                    id={id}
                    role="listbox"
                    aria-label={label}
                    className="admin-select-options"
                >
                    {matches.map((option, index) => (
                        <button
                            type="button"
                            role="option"
                            key={option.code}
                            id={`${id}-${index}`}
                            aria-selected={code === option.code}
                            tabIndex={-1}
                            data-active={active === index || undefined}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => select(option.code)}
                        >
                            <span>
                                {option.label}
                                <small
                                    className="muted"
                                    style={{
                                        display: "block",
                                        textAlign: "left",
                                    }}
                                >
                                    {option.kind === "state" ? "州 / 省" : "城市"}
                                </small>
                            </span>
                            <span>{code === option.code ? "✓" : ""}</span>
                        </button>
                    ))}
                    {!matches.length && (
                        <span className="muted">
                            暂无参考位置，可输入英文州、省或城市名称后保存。
                        </span>
                    )}
                </div>
            )}
            {!!code && !selected && (
                <small className="muted">
                    未收录位置翻译，将使用英文名称；保存时自动规范化标识。
                </small>
            )}
        </div>
    );
}
