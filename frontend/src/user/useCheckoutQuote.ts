import { useEffect, useRef, useState } from "react";
import { request, type Row } from "../shared/api";

export function useCheckoutQuote(enabled: boolean, selection: Row) {
    const key = JSON.stringify(selection);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<{
        key: string;
        data?: Row;
        error?: string;
    }>({ key: "" });
    const [expired, setExpired] = useState(false);
    const sequence = useRef(0);
    useEffect(() => {
        if (!enabled) return;
        const version = ++sequence.current;
        const controller = new AbortController();
        setExpired(false);
        setState({ key });
        void request<Row>("user/order/quote", JSON.parse(key), {
            signal: controller.signal,
        })
            .then((result) => {
                if (sequence.current === version && !controller.signal.aborted)
                    setState({ key, data: result.data });
            })
            .catch((error) => {
                if (sequence.current === version && !controller.signal.aborted)
                    setState({ key, error: error.message });
            });
        return () => controller.abort();
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
        error: current ? state.error : undefined,
        loading: enabled && (!current || (!state.data && !state.error)),
        expired,
        reload: () => setRevision((value) => value + 1),
    };
}
