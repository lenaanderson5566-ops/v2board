/** Non-secret preferences only. Cookie authentication must never depend on Web Storage. */
function optionalStorage(kind: "localStorage" | "sessionStorage") {
    const memory = new Map<string, string | null>();
    return {
        /** A previous write exists only in this page's fallback memory. */
        isTemporary(key: string): boolean { return memory.has(key); },
        getItem(key: string): string | null {
            if (memory.has(key)) return memory.get(key) ?? null;
            try { return globalThis[kind].getItem(key); }
            catch { return null; }
        },
        setItem(key: string, value: string): boolean {
            try { globalThis[kind].setItem(key, value); memory.delete(key); return true; }
            catch { memory.set(key, value); return false; }
        },
        removeItem(key: string): void {
            try { globalThis[kind].removeItem(key); memory.delete(key); }
            catch { memory.set(key, null); }
        },
    };
}
export const localPreferences = optionalStorage("localStorage");
export const sessionPreferences = optionalStorage("sessionStorage");
