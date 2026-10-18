import { type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { tx } from "../i18n";
import { renderMarkdown } from "../markdown";
import DOMPurify from "dompurify";

export function Html({
    value,
    markdown = false,
}: {
    value: unknown;
    markdown?: boolean;
}) {
    return (
        <div
            className="rich-text"
            dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                    markdown ? renderMarkdown(value) : String(value || ""),
                ),
            }}
        />
    );
}

export function Empty({ text = tx("暂无数据") }: { text?: string }) {
    return (
        <div className="state">
            <Inbox size={36} />
            <strong>{text}</strong>
            <span>{tx("数据更新后会显示在这里")}</span>
        </div>
    );
}

export function Panel({
    title,
    children,
    actions,
    className = "",
    padded = false,
}: {
    title?: string;
    children: ReactNode;
    actions?: ReactNode;
    className?: string;
    padded?: boolean;
}) {
    return (
        <section className={`panel ${className}`}>
            {(title || actions) && (
                <div className="panel-head">
                    {title ? <h2>{title}</h2> : <span />}
                    <div className="actions">{actions}</div>
                </div>
            )}
            {padded ? <div className="panel-body">{children}</div> : children}
        </section>
    );
}

export function Metric({
    label,
    value,
    detail,
}: {
    label: string;
    value: ReactNode;
    detail?: string;
}) {
    return (
        <div className="metric">
            <span>{label}</span>
            <strong>{value}</strong>
            {detail && <small>{detail}</small>}
        </div>
    );
}
