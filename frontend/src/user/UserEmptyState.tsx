import type { ReactNode } from "react";
import "./user-controls.css";

// Copy and actions are provided by the page's existing localization helpers.
export function UserEmptyState({
    title,
    description,
    illustration,
    actions,
    compact = false,
    className = "",
}: {
    title: ReactNode;
    description?: ReactNode;
    illustration?: ReactNode;
    actions?: ReactNode;
    compact?: boolean;
    className?: string;
}) {
    return (
        <div
            className={`user-empty-state${compact ? " user-empty-compact" : ""} ${className}`}
        >
            {illustration && (
                <div className="user-empty-illustration" aria-hidden="true">
                    {illustration}
                </div>
            )}
            <h3>{title}</h3>
            {description && <p>{description}</p>}
            {actions && <div className="user-empty-actions">{actions}</div>}
        </div>
    );
}
