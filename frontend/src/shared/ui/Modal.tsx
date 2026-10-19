import { useEffect, useRef, createContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { tx } from "../i18n";
import { boot } from "../api";

export const ModalClose = createContext<(() => void) | undefined>(undefined);
const modalStack: HTMLElement[] = [];
let restoreModalPage: (() => void) | undefined;
export function Modal({
    dismissible = true,
    initialFocus,
    title,
    children,
    close,
    variant,
    wide = false,
    className = "",
}: {
    title: string;
    children: ReactNode;
    close: () => void;
    dismissible?: boolean;
    initialFocus?: string;
    variant?: "modal" | "drawer";
    wide?: boolean;
    className?: string;
}) {
    const dialog = useRef<HTMLElement>(null);
    const closeRef = useRef(close);
    closeRef.current = close;
    const dismissibleRef = useRef(dismissible);
    dismissibleRef.current = dismissible;
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
            preferred ||
            dialog.current?.querySelector<HTMLElement>(
                "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
            ) ||
            element
        )?.focus();
        const fn = (e: KeyboardEvent) => {
            if (modalStack.at(-1) !== element) return;
            if (e.key === "Escape" && dismissibleRef.current) {
                e.preventDefault();
                closeRef.current();
            }
            if (e.key === "Tab") {
                const items = [
                    ...(dialog.current?.querySelectorAll<HTMLElement>(
                        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
                    ) || []),
                ];
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
                if (dismissible && e.target === e.currentTarget) close();
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
                            onClick={close}
                            aria-label={tx("关闭")}
                        >
                            <X />
                        </button>
                    )}
                </div>
                <ModalClose.Provider value={close}>
                    {children}
                </ModalClose.Provider>
            </section>
        </div>,
        document.body,
    );
}
