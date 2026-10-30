import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { completePages } from "../paginated-data";
import { locale } from "../i18n";
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
    const [retryAt, setRetryAt] = useState(0);
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
        // Focus, visibility and repeated clicks must respect a server rate limit.
        if (resultKey === queryKey && retryAt > Date.now()) {
            setLoading(false);
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
                    setRetryAt(0);
                    setData(r.data);
                    setTotal(r.total || 0);
                    setMeta(r.meta);
                }
            })
            .catch((e) => {
                if (live) {
                    setError(e.message);
                    setRetryAt(e.status === 429 ? Date.now() + Math.max(1, Number(e.retryAfter) || 60) * 1000 : 0);
                }
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
        retryAt,
    };
}
