import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AdminRowMenu({ children, context, label = "用户更多操作" }: { children: ReactNode; context?: boolean; label?:string }) {
    const id = useId();
    const menu = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const focusLast = useRef(false);
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])
        .filter(button => !button.closest('[hidden], [inert]') && getComputedStyle(button).visibility !== 'hidden');
    useLayoutEffect(() => {
        if (!open || context || !trigger.current || !menu.current) return;
        const anchor = trigger.current.getBoundingClientRect();
        const bounds = menu.current.getBoundingClientRect();
        const gutter = 8;
        const below = anchor.bottom + 4;
        const above = anchor.top - bounds.height - 4;
        setPosition({
            left: Math.max(gutter, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - gutter)),
            top: Math.max(gutter, Math.min(below + bounds.height <= window.innerHeight - gutter ? below : above, window.innerHeight - bounds.height - gutter)),
        });
    }, [open, context]);
    useEffect(() => {
        if (!open || context) return;
        const buttons = items();
        (focusLast.current ? buttons.at(-1) : buttons[0])?.focus();
        const close = (event: Event) => {
            if (event.target instanceof Node && (menu.current?.contains(event.target) || trigger.current?.contains(event.target))) return;
            setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
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
            onKeyDown={event => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                focusLast.current = event.key === 'ArrowUp';
                setOpen(true);
            }}
            onClick={() => {
                focusLast.current = false;
                setOpen(value => !value);
            }}>更多操作</button>
        {createPortal(<div id={id} ref={menu} hidden={!open} role="group" aria-label={label}
            className="admin-row-popover" style={position}
            onKeyDown={event => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                const buttons = items();
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
