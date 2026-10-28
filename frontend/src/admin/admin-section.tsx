import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { OperationNotice } from "./admin-operation";

export function AdminDetails({ items, className = "" }: {
    items: readonly { label: string; value: ReactNode }[];
    className?: string;
}) {
    return <dl className={`admin-details ${className}`}>
        {items.map(({ label, value }) => <div key={label}>
            <dt>{label}</dt><dd>{value === null || value === undefined || value === "" ? "—" : value}</dd>
        </div>)}
    </dl>;
}

export function AdminSectionHead({
    icon,
    title,
    description,
}: {
    icon: ReactNode;
    title: string;
    description: string;
}) {
    return (
        <div className="admin-section-head">
            <span className="admin-section-icon" aria-hidden="true">
                {icon}
            </span>
            <div>
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
        </div>
    );
}

export function AdminOperationNotice({
    notice,
}: {
    notice: OperationNotice | null;
}) {
    if (!notice) return null;
    const Icon = notice.kind === "error" ? AlertCircle : CheckCircle2;
    return (
        <div
            className={`admin-operation-notice ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
            aria-atomic="true"
        >
            <Icon size={18} aria-hidden="true" />
            <span>{notice.message}</span>
        </div>
    );
}
