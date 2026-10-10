import type { ReactNode } from "react";
import "./status-badge.css";

export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral";

export function orderStatusTone(status: unknown): StatusTone {
    return ({ 0: "warning", 1: "info", 2: "neutral", 3: "success", 4: "neutral" } as Record<string, StatusTone>)[String(status)] || "neutral";
}

export function StatusBadge({ tone = "neutral", children, className = "" }: { tone?: StatusTone; children: ReactNode; className?: string }) {
    return <span className={`badge status-badge ${className}`.trim()} data-tone={tone}>{children}</span>;
}
