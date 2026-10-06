import type { Boot } from "./api";

export function normalizeApiOrigin(value: string): string {
    if (!value) return "";
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
    )
        throw new Error("API address must be an HTTPS origin");
    return url.origin;
}

export function apiUrl(
    path: string,
    origin: string = window.V2BOARD?.apiBaseUrl || "",
): string {
    if (!path.startsWith("/api/") || path.startsWith("//"))
        throw new Error("Invalid API resource path");
    return normalizeApiOrigin(origin) + path;
}

export async function initializeRuntime(mode: "user" | "admin"): Promise<void> {
    let supplied: Partial<Boot> = window.V2BOARD;
    if (!supplied) {
        const configUrl =
            import.meta.env.VITE_CONFIG_URL ||
            (import.meta.env.PROD
                ? new URL(`../${mode}-config.json`, import.meta.url).href
                : `/${mode}-config.json`);
        const response = await fetch(configUrl, {
            credentials: "omit",
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
            throw new Error("Frontend runtime configuration is unavailable");
        supplied = await response.json();
    }
    if (
        !supplied ||
        typeof supplied !== "object" ||
        Array.isArray(supplied) ||
        (supplied.mode && supplied.mode !== mode)
    )
        throw new Error(
            "Frontend entry and runtime configuration do not match",
        );
    const apiBaseUrl = normalizeApiOrigin(
        supplied.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || "",
    );
    if (
        mode === "admin" &&
        (!supplied.adminPath || !/^[a-zA-Z0-9_-]+$/.test(supplied.adminPath))
    )
        throw new Error("Configure the administrative API path");
    window.V2BOARD = {
        title: "FastDog",
        description: "",
        adminPath: "",
        opsPath: "",
        emailVerify: false,
        registerClosed: false,
        recaptchaSiteKey: "",
        tosUrl: "",
        currency: "CNY",
        currencySymbol: "CNY",
        ...supplied,
        mode,
        apiBaseUrl,
        landing:
            mode === "user" &&
            (supplied.landing ??
                !location.pathname.replace(/\/$/, "").endsWith("/app")),
    };
    if (mode === "user") {
        window.V2BOARD.adminPath = "";
        window.V2BOARD.opsPath = "";
    }
    document.body.dataset.console = mode;
    document.title = window.V2BOARD.title;
}

export function startupError(error: unknown): void {
    const root = document.getElementById("root");
    if (root) {
        root.setAttribute("role", "alert");
        root.textContent =
            error instanceof Error ? error.message : "Frontend startup failed";
    }
}
