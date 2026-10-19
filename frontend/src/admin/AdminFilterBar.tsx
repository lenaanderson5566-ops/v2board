import type { ComponentProps } from "react";
import "./admin-controls.css";

// Query validation and application stay with the page; this component owns layout.
export function AdminFilterBar({
    className = "",
    ...props
}: ComponentProps<"form">) {
    return (
        <form
            aria-label="筛选条件"
            {...props}
            className={`admin-filter-bar ${className}`}
        />
    );
}
