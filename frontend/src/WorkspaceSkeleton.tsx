import { tx } from "./i18n";
export function WorkspaceSkeleton({ full = false }: { full?: boolean }) {
    return (
        <div
            className={full ? "workspace-skeleton full" : "workspace-skeleton"}
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">{tx("正在加载工作空间…")}</span>
            <div aria-hidden="true" className="skeleton-heading" />
            <div className="skeleton-metrics" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>
            <div className="skeleton-panels" aria-hidden="true">
                <i />
                <i />
            </div>
        </div>
    );
}
