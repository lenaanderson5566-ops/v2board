import { Fragment, type ReactNode } from "react";
import { WorkspaceSkeleton } from "../WorkspaceSkeleton";
import { e } from "../experience-copy";
import { tx } from "../i18n";
import { boot } from "../api";
import { useRetryCountdown } from "../use-retry-countdown";
export { useData } from "./useData";

export function State({
    loading,
    error,
    children,
    retry,
    retryAt = 0,
    data,
}: {
    data?: unknown;
    loading: boolean;
    error: string;
    children: ReactNode;
    retry?: () => void;
    retryAt?: number;
}) {
    const retryIn = useRetryCountdown(retryAt);
    const retryButton = retry && (
        <button type="button" disabled={loading || retryIn > 0} onClick={retry}>
            {retryIn > 0 ? tx("retryIn", { ns: "pricing", seconds: retryIn }) : tx("重试")}
        </button>
    );
    if (boot.mode === "admin" && data != null)
        return (
            <div className="admin-data-state" aria-busy={loading}>
                {loading && (
                    <div
                        key="loading"
                        className="admin-refresh-note"
                        role="status"
                    >
                        {e("adminRefreshing")}
                    </div>
                )}
                {error && (
                    <div key="error" className="alert" role="alert">
                        {error}
                        <small className="admin-stale-warning">
                            {e("adminStale")}
                        </small>
                        {retryButton}
                    </div>
                )}
                <div
                    key="content"
                    inert={loading || undefined}
                    className={loading ? "admin-stale-content" : undefined}
                >
                    {children}
                </div>
            </div>
        );
    if (boot.mode === "user")
        return (
            <>
                {loading && (data != null ? (
                    <span key="refresh" className="sr-only" role="status">
                        {e("refreshing")}
                    </span>
                ) : <WorkspaceSkeleton key="loading" />)}
                {error && (
                    <div key="error" className="alert" role="alert">
                        {error}
                        {retryButton}
                    </div>
                )}
                {/* Keep the same child subtree during background refreshes and failures.
                    Wrapping it only while loading remounts forms and payment controls. */}
                <Fragment key="content">
                    {(data != null || (!loading && !error)) && children}
                </Fragment>
            </>
        );
    if (loading)
        return (
            <div className="state" role="status" aria-live="polite">
                <span className="spinner" />
                {tx("正在加载…")}
            </div>
        );
    if (error)
        return (
            <>
                <div className="alert" role="alert">
                    {error}
                    {retryButton}
                </div>
                {data != null && children}
            </>
        );
    return <>{children}</>;
}
