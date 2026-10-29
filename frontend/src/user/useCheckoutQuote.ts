import { useEffect, useRef, useState } from "react";
import { request, type Row } from "../shared/api";
import { useRetryCountdown } from "../shared/use-retry-countdown";

export function useCheckoutQuote(enabled: boolean, selection: Row) {
    const key = JSON.stringify(selection);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<{
        key: string;
        data?: Row;
        error?: string;
        status?: number;
        retryAt?: number;
    }>({ key: "" });
    const [expired, setExpired] = useState(false);
    const sequence = useRef(0);
    const retryIn = useRetryCountdown(state.retryAt);
    useEffect(() => {
        if (!enabled || (state.retryAt || 0) > Date.now()) return;
        const version = ++sequence.current;
        const controller = new AbortController();
        setExpired(false);
        setState({ key });
        const timer = window.setTimeout(() => {
            void request<Row>("user/order/quote", JSON.parse(key), {
                signal: controller.signal,
            })
                .then((result) => {
                    if (
                        sequence.current === version &&
                        !controller.signal.aborted
                    )
                        setState({ key, data: result.data });
                })
                .catch((error) => {
                    if (
                        sequence.current === version &&
                        !controller.signal.aborted
                    )
                        setState({
                            key,
                            error: error.message,
                            status: error.status,
                            retryAt:
                                error.status === 429
                                    ? Date.now() +
                                      Math.max(
                                          1,
                                          Number(error.retryAfter) || 60,
                                      ) *
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
    useEffect(() => {
        if (!state.data) return;
        const delay = Number(state.data.expires_at) * 1000 - Date.now();
        if (delay <= 0) {
            setExpired(true);
            return;
        }
        const timer = window.setTimeout(() => setExpired(true), delay);
        return () => window.clearTimeout(timer);
    }, [state.data]);
    const current = state.key === key;
    return {
        data: current ? state.data : undefined,
        error: current || state.status === 429 ? state.error : undefined,
        status: current || state.status === 429 ? state.status : undefined,
        retryIn,
        loading:
            enabled &&
            state.status !== 429 &&
            (!current || (!state.data && !state.error)),
        expired,
        reload: () => {
            if ((state.retryAt || 0) <= Date.now())
                setRevision((value) => value + 1);
        },
    };
}
