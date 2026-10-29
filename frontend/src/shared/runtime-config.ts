import type { Boot } from "./api";
import startupCopy from "./startup-copy.json";

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
        passkeyEnabled: false,
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

// Startup recovery must work even when React, i18n or a language chunk failed to load.
export function startupError(_error: unknown, retry = () => window.location.reload()): void {
    const root = document.getElementById("root");
    if (root) {
        let language = window.V2BOARD?.mode === "admin" ? "zh-CN" : navigator.language;
        try { language = localStorage.getItem("v2board.language") || language; } catch { /* Use browser language when storage is unavailable. */ }
        const key = /^zh/i.test(language)
            ? /TW|HK|MO|Hant/i.test(language) ? "zh-TW" : "zh-CN"
            : language.toLowerCase().split("-")[0];
        const [title, message, action] = Object.prototype.hasOwnProperty.call(startupCopy, key)
            ? startupCopy[key as keyof typeof startupCopy] : startupCopy.en;
        const panel = document.createElement("section");
        panel.style.cssText = "box-sizing:border-box;max-width:560px;margin:15vh auto;padding:32px 24px;font:16px/1.7 system-ui,sans-serif;color:#182638";
        panel.dir = key === "fa" ? "rtl" : "ltr";
        panel.lang = language;
        const heading = document.createElement("h1");
        heading.textContent = title;
        heading.tabIndex = -1;
        heading.style.cssText = "font-size:24px;margin:0 0 12px";
        const help = document.createElement("p");
        help.textContent = message;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action;
        button.style.cssText = "min-height:44px;padding:10px 20px;border:0;border-radius:10px;background:#153b70;color:white;font:inherit;cursor:pointer";
        button.addEventListener("click", retry);
        panel.append(heading, help, button);
        root.setAttribute("role", "alert");
        root.replaceChildren(panel);
        heading.focus();
    }
}
