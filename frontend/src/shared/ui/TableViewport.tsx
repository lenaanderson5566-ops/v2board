import type { ComponentProps } from "react";
import { tx } from "../i18n";

/** One keyboard-accessible scroll boundary for both custom and shared tables. */
export function TableViewport({
    className = "",
    children,
    ...props
}: ComponentProps<"div">) {
    return (
        <div
            role="region"
            aria-label={tx("数据表格")}
            tabIndex={0}
            {...props}
            className={`table-scroll table-viewport ${className}`.trim()}
        >
            {children}
        </div>
    );
}
