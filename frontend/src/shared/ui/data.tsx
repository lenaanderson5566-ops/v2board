import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { completePages } from "../paginated-data";
import { WorkspaceSkeleton } from "../WorkspaceSkeleton";
import { e } from "../experience-copy";
import { tx, locale } from "../i18n";
import { boot, readRequest, type Row } from "../api";

export function useData<T = Row>(
    path: string,
    body?: Row,
    allPages = false,
    options: { refreshOnEvents?: boolean } = {},
) {
    const refreshOnEvents = options.refreshOnEvents !== false;
    useTranslation();
    const language = locale();
    const serializedBody = body ? JSON.stringify(body) : undefined;
    const queryKey = JSON.stringify([path, serializedBody, language, allPages]);
    const [resultKey, setResultKey] = useState(queryKey);
    const [meta, setMeta] = useState<Row | undefined>();
    const [data, setData] = useState<T | null>(null),
        [error, setError] = useState(""),
        [loading, setLoading] = useState(true),
        [version, setVersion] = useState(0),
        [total, setTotal] = useState(0);
    useEffect(() => {
        let live = true;
        setResultKey(queryKey);
        if (resultKey !== queryKey) {
            setData(null);
            setTotal(0);
            setMeta(undefined);
        }
        if (!path) {
            setLoading(false);
            setData(null);
            setError("");
            setTotal(0);
            setMeta(undefined);
            return;
        }
        setLoading(true);
        setError("");
        readRequest<T>(
            path,
            serializedBody ? JSON.parse(serializedBody) : undefined,
            version > 0,
        )
            .then(async (r) => {
                if (allPages && Array.isArray(r.data)) {
                    r = (await completePages(
                        r as any,
                        (page) => {
                            const [base, search] = path.split("?");
                            const query = new URLSearchParams(search);
                            query.set("current", String(page));
                            return readRequest<any[]>(
                                `${base}?${query}`,
                                undefined,
                                version > 0,
                            );
                        },
                        () => live,
                    )) as typeof r;
                }
                if (live) {
                    setData(r.data);
                    setTotal(r.total || 0);
                    setMeta(r.meta);
                }
            })
            .catch((e) => {
                if (live) setError(e.message);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [path, version, serializedBody, language, allPages]);
    useEffect(() => {
        if (boot.mode !== "user" || !path || !refreshOnEvents) return;
        const refresh = () => setVersion((v) => v + 1);
        let lastResume: number | undefined;
        const resume = () => {
            if (document.visibilityState === "hidden") return;
            const now = Date.now();
            if (lastResume !== undefined && now - lastResume < 1000) return;
            lastResume = now;
            refresh();
        };
        const visible = () => {
            if (document.visibilityState === "visible") resume();
        };
        window.addEventListener("data-changed", refresh);
        window.addEventListener("focus", resume);
        document.addEventListener("visibilitychange", visible);
        return () => {
            window.removeEventListener("data-changed", refresh);
            window.removeEventListener("focus", resume);
            document.removeEventListener("visibilitychange", visible);
        };
    }, [path, refreshOnEvents]);
    const reload = useCallback(() => setVersion((v) => v + 1), []);
    return {
        data: path && resultKey === queryKey ? data : null,
        error: path && resultKey === queryKey ? error : "",
        loading: !!path && (resultKey !== queryKey || loading),
        total: path && resultKey === queryKey ? total : 0,
        meta: path && resultKey === queryKey ? meta : undefined,
        reload,
    };
}

export function State({
    loading,
    error,
    children,
    retry,
    data,
}: {
    data?: unknown;
    loading: boolean;
    error: string;
    children: ReactNode;
    retry?: () => void;
}) {
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
                        {retry && (
                            <button type="button" onClick={retry}>
                                {tx("重试")}
                            </button>
                        )}
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
    if (loading && boot.mode === "user")
        return data != null ? (
            <div className="refreshing-content" aria-busy="true">
                <span className="refresh-status" role="status">
                    {e("refreshing")}
                </span>
                {children}
            </div>
        ) : (
            <WorkspaceSkeleton />
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
                    {retry && <button onClick={retry}>{tx("重试")}</button>}
                </div>
                {data != null && children}
            </>
        );
    return <>{children}</>;
}
