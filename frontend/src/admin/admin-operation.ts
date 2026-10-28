import { useCallback, useEffect, useRef, useState } from "react";

export type OperationNotice = { kind: "success" | "error"; message: string };

/** Guard rapid submissions before React has rendered the disabled button. */
export function useAdminOperation() {
    const lock = useRef(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<OperationNotice | null>(null);
    const generation = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; generation.current++; };
    }, []);
    const clear = useCallback(() => {
        generation.current++;
        setNotice(null);
    }, []);

    const run = useCallback(async (operation: () => Promise<string>) => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setNotice(null);
        const current = ++generation.current;
        const publish = (value: OperationNotice) => {
            if (mounted.current && current === generation.current) setNotice(value);
        };
        try {
            publish({ kind: "success", message: await operation() });
        } catch (error) {
            publish({
                kind: "error",
                message:
                    error instanceof Error
                        ? error.message
                        : "操作失败，请重试。",
            });
        } finally {
            lock.current = false;
            if (mounted.current) setBusy(false);
        }
    }, []);

    return { busy, notice, run, clear };
}
