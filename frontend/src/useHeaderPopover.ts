import { useEffect, useId, useRef, useState } from "react";

export function useHeaderPopover() {
    const id = useId();
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const other = (event: Event) => {
            if ((event as CustomEvent).detail !== id) setOpen(false);
        };
        window.addEventListener("header-popover-open", other);
        return () => window.removeEventListener("header-popover-open", other);
    }, [id]);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
                trigger.current?.focus();
                return;
            }
            if (
                !root.current?.contains(document.activeElement) ||
                !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            )
                return;
            const items = [
                ...root.current.querySelectorAll<HTMLElement>(
                    "[data-popover-item]",
                ),
            ];
            if (!items.length) return;
            event.preventDefault();
            const current = items.indexOf(
                document.activeElement as HTMLElement,
            );
            const index =
                event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (current +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            items.length) %
                        items.length;
            items[index].focus();
        };
        (
            root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ||
            root.current?.querySelector<HTMLElement>("[data-popover-item]")
        )?.focus();
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", keyboard);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", keyboard);
        };
    }, [open]);
    return {
        id,
        open,
        setOpen,
        root,
        trigger,
        toggle: () => {
            if (!open)
                window.dispatchEvent(
                    new CustomEvent("header-popover-open", { detail: id }),
                );
            setOpen(!open);
        },
    };
}
