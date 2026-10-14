import { useRef, useState } from "react";

export type OperationNotice = { kind: "success" | "error"; message: string };

/** Guard rapid submissions before React has rendered the disabled button. */
export function useAdminOperation() {
    const lock = useRef(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<OperationNotice | null>(null);

    async function run(operation: () => Promise<string>) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setNotice(null);
        try {
            setNotice({ kind: "success", message: await operation() });
        } catch (error) {
            setNotice({
                kind: "error",
                message:
                    error instanceof Error
                        ? error.message
                        : "操作失败，请重试。",
            });
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    return { busy, notice, run, clear: () => setNotice(null) };
}
