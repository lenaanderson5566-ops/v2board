export function readListView(key: string): Record<string, any> {
    try {
        const value = JSON.parse(
            sessionStorage.getItem(`admin.list.${key}`) || "{}",
        );
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
    } catch {
        return {};
    }
}

export function saveListView(key: string, value: object): void {
    try {
        sessionStorage.setItem(`admin.list.${key}`, JSON.stringify(value));
    } catch {
        /* Lists remain usable when browser storage is unavailable. */
    }
}

export function clearListViews(): void {
    try {
        Object.keys(sessionStorage)
            .filter((key) => key.startsWith("admin.list."))
            .forEach((key) => sessionStorage.removeItem(key));
    } catch {
        /* Storage may be disabled. */
    }
}
