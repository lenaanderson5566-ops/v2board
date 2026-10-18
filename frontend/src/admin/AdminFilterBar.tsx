import type { ComponentProps } from "react";
import "./admin-controls.css";

// Query validation and application stay with the page; this component owns layout.
export function AdminFilterBar({ className = "", ...props }: ComponentProps<"form">) {
    return <form {...props} className={`admin-filter-bar ${className}`} />;
}
