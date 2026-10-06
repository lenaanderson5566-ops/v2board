import { useEffect, useId, useRef, useState } from "react";
import locations from "../../../resources/client/node-locations.json";

const options = [
    { code: "", label: "保留原节点名称", search: "保留原节点名称" },
    ...Object.entries(locations.regions).map(([code, names]) => ({
        code,
        label: `${names["zh-CN"]} / ${names["en-US"]} (${code})`,
        search: [code, ...Object.values(names)].join(" ").toLowerCase(),
    })),
];

export function AdminRegionSelect({ label, value, onChange }: {
    label: string;
    value: unknown;
    onChange: (value: string) => void;
}) {
    const listId = useId();
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const code = String(value ?? "");
    const selected = options.find(option => option.code === code);
    const matches = options.filter(option => option.search.includes(query.trim().toLowerCase()));
    useEffect(() => {
        if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
    }, [open, active, query, listId]);
    const close = () => { setOpen(false); setQuery(""); setActive(0); };
    const select = (next: string) => { onChange(next); input.current?.focus(); close(); };
    return (
        <div className="admin-multiselect admin-region-select" onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
        }}>
            <div className="admin-select-control">
                <input ref={input} role="combobox" aria-label={label}
                    aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
                    aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
                    autoComplete="off" placeholder="输入国家 / 地区名称或代码"
                    value={open ? query : selected?.label ?? code}
                    onFocus={() => setOpen(true)}
                    onClick={() => setOpen(true)}
                    onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
                    onKeyDown={event => {
                        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault(); setOpen(true);
                            setActive(open ? Math.max(0, Math.min(matches.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))) : 0);
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            if (open && matches[active]) select(matches[active].code);
                            else setOpen(true);
                        }
                    }} />
                <button type="button" aria-label={`清空 ${label}`} onClick={() => select("")}>×</button>
                <button type="button" aria-label={`展开 ${label}`} onClick={() => {
                    if (open) close(); else { input.current?.focus(); setOpen(true); }
                }}>⌄</button>
            </div>
            {open && <div id={listId} role="listbox" aria-label={label} className="admin-select-options">
                {matches.map((option, index) => <button type="button" role="option"
                    id={`${listId}-${index}`} key={option.code} tabIndex={-1}
                    aria-selected={code === option.code} data-active={active === index || undefined}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => select(option.code)}>
                    {option.label}<span>{code === option.code ? "✓" : ""}</span>
                </button>)}
                {!matches.length && <span className="muted">未找到匹配的国家 / 地区</span>}
            </div>}
        </div>
    );
}
