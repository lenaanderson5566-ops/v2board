import { useEffect, useRef, createContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { tx } from "../i18n";
import { boot } from "../api";

export const ModalClose = createContext<(() => void) | undefined>(undefined);
const modalStack: HTMLElement[] = [];
let restoreModalPage: (() => void) | undefined;
function focusableItems(element: HTMLElement): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>(
        'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex], [contenteditable="true"]',
    )].filter((item) => {
        if (item.tabIndex < 0 || item.matches(':disabled, input[type="hidden"]') || item.closest("[hidden], [inert]")) return false;
        for (let parent: HTMLElement | null = item; parent && parent !== element; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden") return false;
        }
        return true;
    });
}
export function Modal({
    dismissible = true,
    initialFocus,
    title,
    children,
    close,
    variant,
    wide = false,
    className = "",
    guardChanges = false,
}: {
    title: string;
    children: ReactNode;
    close: () => void;
    dismissible?: boolean;
    initialFocus?: string;
    variant?: "modal" | "drawer";
    wide?: boolean;
    className?: string;
    guardChanges?: boolean;
}) {
    const dialog = useRef<HTMLElement>(null);
    const closeRef = useRef(close);
    closeRef.current = close;
    const dismissibleRef = useRef(dismissible);
    dismissibleRef.current = dismissible;
    const guardRef = useRef(guardChanges);
    guardRef.current = guardChanges;
    function requestClose() {
        if (!dismissibleRef.current) return;
        const element = dialog.current;
        if (guardRef.current && element) {
            if (element.querySelector('[data-saving="true"], form[aria-busy="true"]')) return;
            if (element.querySelector('[data-unsaved="true"]') && !window.confirm(tx("有尚未保存的修改，确认放弃？"))) return;
        }
        closeRef.current();
    }
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const element = dialog.current!;
        if (!modalStack.length) {
            const previousOverflow = document.body.style.overflow;
            const root = document.getElementById("root");
            const previousInert = root?.inert;
            document.body.style.overflow = "hidden";
            if (root) root.inert = true;
            restoreModalPage = () => {
                document.body.style.overflow = previousOverflow;
                if (root) root.inert = previousInert || false;
            };
        }
        modalStack.forEach((modal) => {
            modal.inert = true;
        });
        modalStack.push(element);
        const preferred = initialFocus
            ? dialog.current?.querySelector<HTMLElement>(initialFocus)
            : null;
        (
            (preferred && focusableItems(element).includes(preferred) ? preferred : null) ||
            focusableItems(element)[0] ||
            element
        )?.focus();
        const fn = (e: KeyboardEvent) => {
            if (modalStack.at(-1) !== element) return;
            if (e.key === "Escape" && dismissibleRef.current) {
                e.preventDefault();
                requestClose();
            }
            if (e.key === "Tab") {
                const items = focusableItems(element);
                const first = items[0],
                    last = items.at(-1);
                if (!first) {
                    e.preventDefault();
                    element.focus();
                } else if (
                    e.shiftKey &&
                    (document.activeElement === first ||
                        document.activeElement === element)
                ) {
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
            const wasTop = modalStack.at(-1) === element;
            const index = modalStack.indexOf(element);
            if (index >= 0) modalStack.splice(index, 1);
            const top = modalStack.at(-1);
            if (top) top.inert = false;
            else {
                restoreModalPage?.();
                restoreModalPage = undefined;
            }
            if (wasTop) {
                if (previous?.isConnected && (!top || top.contains(previous)))
                    previous.focus();
                else top?.focus();
            }
        };
    }, []);
    return createPortal(
        <div
            className={
                "overlay" +
                (boot.mode === "admin" &&
                (variant === "drawer" ||
                    (!variant &&
                        /编辑|新建|设置|配置|高级筛选/.test(title)))
                    ? " admin-drawer"
                    : "") +
                (wide ? " admin-wide-drawer" : "") +
                " " +
                className
            }
            onMouseDown={(e) => {
                if (modalStack.at(-1) === dialog.current && e.target === e.currentTarget) requestClose();
            }}
        >
            <section
                className="modal"
                ref={dialog}
                role="dialog"
                tabIndex={-1}
                aria-modal="true"
                aria-label={title}
            >
                <div className="panel-head">
                    <h2>{title}</h2>
                    {dismissible && (
                        <button
                            className="icon-button"
                            type="button"
                            onClick={requestClose}
                            aria-label={tx("关闭")}
                        >
                            <X />
                        </button>
                    )}
                </div>
                <ModalClose.Provider value={requestClose}>
                    {children}
                </ModalClose.Provider>
            </section>
        </div>,
        document.body,
    );
}
