import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AdminRowMenu({ children, context, label = "用户更多操作" }: { children: ReactNode; context?: boolean; label?:string }) {
    const id = useId();
    const menu = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    useEffect(() => {
        if (!open || context) return;
        menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        const close = (event: Event) => {
            if (event.target instanceof Node && (menu.current?.contains(event.target) || trigger.current?.contains(event.target))) return;
            setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("focusin", close);
        document.addEventListener("keydown", escape);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("focusin", close);
            document.removeEventListener("keydown", escape);
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", close, true);
        };
    }, [open, context]);
    if (context) return <div className="row-menu-content">{children}</div>;
    return <>
        <button type="button" ref={trigger} aria-controls={id} aria-expanded={open}
            onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setPosition({left: Math.max(8, Math.min(rect.right - 210, window.innerWidth - 218)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 330))});
                setOpen(value => !value);
            }}>更多操作</button>
        {createPortal(<div id={id} ref={menu} hidden={!open} role="group" aria-label={label}
            className="admin-row-popover" style={position}
            onKeyDown={event => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
                if (!buttons.length) return;
                event.preventDefault();
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }}
            onClick={event => {
                if (open && menu.current?.contains(event.target as Node) && (event.target as HTMLElement).closest("button:not(:disabled)")) {
                    trigger.current?.focus();
                    setOpen(false);
                }
            }}>{children}</div>, document.body)}
    </>;
}
