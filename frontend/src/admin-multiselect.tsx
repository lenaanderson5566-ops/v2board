import { useEffect, useRef, useState } from "react";
export function AdminMultiSelect({
    label,
    options,
    value,
    onChange,
    creatable = false,
}: {
    label: string;
    options: [string, string][];
    value: unknown;
    onChange: (value: (number | string)[]) => void;
    creatable?: boolean;
}) {
    const root = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false),
        [search, setSearch] = useState("");
    const selected = (Array.isArray(value) ? value : []).map(String);
    const save = (keys: string[]) =>
        onChange(
            keys.map((key) =>
                !creatable && /^\d+$/.test(key) ? Number(key) : key,
            ),
        );
    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);
    return (
        <div ref={root} className="admin-multiselect">
            <div className="admin-select-control">
                {selected.map((key) => (
                    <span className="admin-select-tag" key={key}>
                        {options.find(([id]) => id === key)?.[1] || key}
                        <button
                            type="button"
                            aria-label={`移除 ${options.find(([id]) => id === key)?.[1] || key}`}
                            onClick={() =>
                                save(selected.filter((id) => id !== key))
                            }
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    role="combobox"
                    aria-label={label}
                    aria-expanded={open}
                    value={search}
                    placeholder={
                        selected.length
                            ? ""
                            : creatable
                              ? "输入标签后按回车"
                              : "请选择"
                    }
                    onFocus={() => setOpen(true)}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setOpen(true);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") setOpen(false);
                        if (e.key === "Enter") {
                            e.preventDefault();
                            if (creatable && search.trim()) {
                                save([
                                    ...new Set([...selected, search.trim()]),
                                ]);
                                setSearch("");
                                return;
                            }
                            const option = options.find(([, text]) =>
                                text.includes(search),
                            );
                            if (option) {
                                save(
                                    selected.includes(option[0])
                                        ? selected.filter(
                                              (id) => id !== option[0],
                                          )
                                        : [...selected, option[0]],
                                );
                                setSearch("");
                            }
                        }
                    }}
                />
                <button
                    type="button"
                    aria-label={`清空 ${label}`}
                    onClick={() => save([])}
                >
                    ×
                </button>
                <button
                    type="button"
                    aria-label={`展开 ${label}`}
                    onClick={() => setOpen(!open)}
                >
                    ⌄
                </button>
            </div>
            {open && (
                <div
                    role="listbox"
                    aria-label={label}
                    aria-multiselectable="true"
                    className="admin-select-options"
                >
                    {options
                        .filter(([, text]) =>
                            text.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map(([key, text]) => (
                            <button
                                type="button"
                                role="option"
                                aria-selected={selected.includes(key)}
                                key={key}
                                onClick={() => {
                                    save(
                                        selected.includes(key)
                                            ? selected.filter(
                                                  (id) => id !== key,
                                              )
                                            : [...selected, key],
                                    );
                                    setSearch("");
                                }}
                            >
                                {text}
                                <span>{selected.includes(key) ? "✓" : ""}</span>
                            </button>
                        ))}
                    {creatable &&
                        search.trim() &&
                        !selected.includes(search.trim()) && (
                            <button
                                type="button"
                                role="option"
                                aria-selected={false}
                                onClick={() => {
                                    save([...selected, search.trim()]);
                                    setSearch("");
                                }}
                            >
                                添加 {search.trim()}
                            </button>
                        )}
                    {!options.length && !creatable && (
                        <span className="muted">暂无选项</span>
                    )}
                </div>
            )}
        </div>
    );
}
