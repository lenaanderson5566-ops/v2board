import { useCallback, useEffect, useRef, useState } from "react";
import { request, type Row } from "../shared/api";
import { locale } from "../shared/i18n";
import { useRetryCountdown } from "../shared/use-retry-countdown";

type QuoteState = {
    key: string;
    data?: Row;
    error?: string;
    status?: number;
    retryAt?: number;
};
type CachedQuote = { data: Row; expires: number };
const CACHE_TTL = 30_000;
const CACHE_LIMIT = 10;
const EXPIRY_MARGIN = 5_000;

export function useCheckoutQuote(
    enabled: boolean,
    selection: Row,
    currency = "CNY",
) {
    const body = JSON.stringify(selection);
    const key = JSON.stringify([currency, locale(), body]);
    const cache = useRef(new Map<string, CachedQuote>());
    const activeRequest = useRef<AbortController | undefined>(undefined);
    const authExpired = useRef(false);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<QuoteState>({ key: "" });
    const [expired, setExpired] = useState(false);
    const sequence = useRef(0);
    const retryIn = useRetryCountdown(state.retryAt);
    const invalidate = useCallback(() => {
        cache.current.clear();
        sequence.current++;
        activeRequest.current?.abort();
        // Asset changes cannot bypass an existing server cooldown.
        setState((previous) =>
            previous.status === 429
                ? { ...previous, data: undefined }
                : { key: "" },
        );
        setRevision((value) => value + 1);
    }, []);
    useEffect(() => {
        const stop = () => {
            authExpired.current = true;
            invalidate();
        };
        window.addEventListener("data-changed", invalidate);
        window.addEventListener("auth-expired", stop);
        return () => {
            window.removeEventListener("data-changed", invalidate);
            window.removeEventListener("auth-expired", stop);
            cache.current.clear();
            sequence.current++;
            activeRequest.current?.abort();
        };
    }, [invalidate]);
    useEffect(() => {
        if (
            !enabled ||
            authExpired.current ||
            (state.retryAt || 0) > Date.now()
        )
            return;
        const version = ++sequence.current;
        const now = Date.now();
        for (const [entryKey, entry] of cache.current) {
            if (entry.expires <= now) cache.current.delete(entryKey);
        }
        const cached = cache.current.get(key);
        setExpired(false);
        if (cached) {
            cache.current.delete(key);
            cache.current.set(key, cached);
            setState({ key, data: cached.data });
            return;
        }
        const controller = new AbortController();
        activeRequest.current = controller;
        setState({ key });
        const timer = window.setTimeout(() => {
            void request<Row>("user/order/quote", JSON.parse(body), {
                signal: controller.signal,
            })
                .then((result) => {
                    if (
                        sequence.current !== version ||
                        controller.signal.aborted
                    )
                        return;
                    const received = Date.now();
                    const expires = Math.min(
                        received + CACHE_TTL,
                        Number(result.data.expires_at) * 1000 - EXPIRY_MARGIN,
                    );
                    if (Number.isFinite(expires) && expires > received) {
                        cache.current.delete(key);
                        cache.current.set(key, { data: result.data, expires });
                        while (cache.current.size > CACHE_LIMIT)
                            cache.current.delete(
                                cache.current.keys().next().value!,
                            );
                    }
                    setState({ key, data: result.data });
                })
                .catch((error) => {
                    if (
                        sequence.current !== version ||
                        controller.signal.aborted
                    )
                        return;
                    // Errors never become reusable quotes. A conflict can invalidate every combination.
                    cache.current.clear();
                    setState({
                        key,
                        error: error.message,
                        status: error.status,
                        retryAt:
                            error.status === 429
                                ? Date.now() +
                                  Math.max(1, Number(error.retryAfter) || 60) *
                                      1000
                                : 0,
                    });
                });
        }, 150);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [enabled, key, revision]);
    const cached = cache.current.get(key);
    const current = state.key === key;
    // A cache hit is usable on the first render of a return selection, without a loading flash.
    const data = authExpired.current
        ? undefined
        : current
          ? state.data
          : state.status !== 429 && cached && cached.expires > Date.now()
            ? cached.data
            : undefined;
    useEffect(() => {
        if (!data) return;
        const delay = Number(data.expires_at) * 1000 - Date.now();
        if (delay <= 0) {
            setExpired(true);
            return;
        }
        const timer = window.setTimeout(() => setExpired(true), delay);
        return () => window.clearTimeout(timer);
    }, [data]);
    return {
        data,
        error: current || state.status === 429 ? state.error : undefined,
        status: current || state.status === 429 ? state.status : undefined,
        retryIn,
        loading:
            enabled &&
            state.status !== 429 &&
            !data &&
            (!current || !state.error),
        expired: data ? Number(data.expires_at) * 1000 <= Date.now() : expired,
        reload: () => {
            if ((state.retryAt || 0) <= Date.now()) invalidate();
        },
    };
}
