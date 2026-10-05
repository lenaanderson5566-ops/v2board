import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

// Native disclosure works with touch, keyboard and without hover support.
export function InlineHelp({ label, children }: { label: string; children: ReactNode }) {
    return <details className="inline-help" onKeyDown={(event) => {
        if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
        }
    }}>
        <summary aria-label={label}><CircleHelp size={16} aria-hidden="true" /></summary>
        <div className="inline-help-content">{children}</div>
    </details>;
}
