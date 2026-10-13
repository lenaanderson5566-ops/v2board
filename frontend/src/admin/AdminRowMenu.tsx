import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function AdminRowMenu({
    children,
    context,
}: {
    children: ReactNode;
    context?: boolean;
}) {
    const id = useId();
    const menu = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const close = (event: Event) => {
            if (
                event.target instanceof Node &&
                menu.current?.contains(event.target)
            )
                return;
            menu.current?.hidePopover();
        };
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        return () => {
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", close, true);
        };
    }, []);
    if (context) return <div className="row-menu-content">{children}</div>;
    return (
        <>
            <button
                aria-controls={id}
                aria-haspopup="true"
                aria-expanded={open}
                onClick={(event) => {
                    const panel = menu.current;
                    if (!panel) return;
                    if (panel.matches(":popover-open")) {
                        panel.hidePopover();
                        return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    panel.style.left = `${Math.max(8, Math.min(rect.right - 210, window.innerWidth - 218))}px`;
                    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 330))}px`;
                    panel.showPopover();
                }}
            >
                更多操作
            </button>
            <div
                id={id}
                ref={menu}
                popover="auto"
                onToggle={() =>
                    setOpen(menu.current?.matches(":popover-open") ?? false)
                }
                className="admin-row-popover"
                onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button"))
                        menu.current?.hidePopover();
                }}
            >
                {children}
            </div>
        </>
    );
}
