import { apiUrl } from "./runtime-config";
import { v10Request } from "./v10-api";
import { createReadCache } from "./read-cache";
import { tx, locale } from "./i18n";
export type Row = Record<string, any>;
export interface Envelope<T> {
    data: T;
    total?: number;
    meta?: Row;
    type?: number;
    message?: string;
    errors?: Record<string, string[]>;
    code?: string;
}
export interface Boot {
    apiBaseUrl?: string;
    footerHtml?: string;
    clientRecommendations?: Record<string, (string | null)[]>;
    clientPolicies?: Record<
        string,
        { enabled: boolean; minVersion?: string | null }
    >;
    clientMirrors?: Record<string, string>;
    legacyDownloads?: Record<string, string>;
    landing?: boolean;
    mode: "user" | "admin";
    title: string;
    description: string;
    adminPath: string;
    opsPath: string;
    emailVerify: boolean;
    registerClosed: boolean;
    inviteRequired?: boolean;
    creditAccessPolicy?: boolean;
    appleAccountEnabled?: boolean;
    emailWhitelistEnabled?: boolean;
    emailWhitelistSuffixes?: string[];
    recaptchaSiteKey: string;
    tosUrl: string;
    currency?: "CNY";
    currencySymbol: string;
}
declare global {
    interface Window {
        V2BOARD: Boot;
        grecaptcha?: {
            render: (el: HTMLElement, opts: Row) => number;
            reset: (id: number) => void;
        };
    }
}
export const boot = window.V2BOARD;
export const storageKey = `v2board.${boot.mode}${boot.apiBaseUrl ? "." + encodeURIComponent(boot.apiBaseUrl) : ""}.auth`;
export const admin = (path: string) => `${boot.adminPath}/${path}`;
export const ops = (path: string) => `${boot.opsPath}/${path}`;
const readCache = createReadCache();
const cacheable = new Set([
    "user/info",
    "user/getSubscribe",
    "user/notice/fetch",
    "user/server/fetch",
]);
export function readRequest<T = Row>(
    path: string,
    body?: Row,
    fresh = false,
): Promise<Envelope<T>> {
    if (boot.mode !== "user" || body || !cacheable.has(path))
        return request<T>(path, body);
    return readCache.read(
        `${localStorage.getItem(storageKey) || ""}\0${locale()}\0${path}`,
        () => request<T>(path),
        fresh,
    );
}
export function clearReadCache() {
    readCache.clear();
}
export async function logoutSession() {
    try {
        await request("user/logout", {});
    } catch {
        /* Local logout remains possible if the network is unavailable. */
    } finally {
        clearReadCache();
        localStorage.removeItem(storageKey);
    }
}
export async function request<T = Row>(
    path: string,
    body?: Row | FormData,
    options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<Envelope<T>> {
    if (body) readCache.clear();
    const token = localStorage.getItem(storageKey);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        abort();
    }, options?.timeoutMs ?? 30000);
    try {
        const v10 =
            boot.mode === "user" && /^(user|passport|guest)\//.test(path)
                ? v10Request(path, body instanceof FormData ? undefined : body)
                : null;
        const res = await fetch(apiUrl(v10?.url ?? `/api/v1/${path}`), {
            credentials: "omit",
            signal: controller.signal,
            method: v10?.method ?? (body ? "POST" : "GET"),
            headers: {
                Accept: "application/json",
                ...(v10
                    ? { "Accept-Language": locale() }
                    : { "Content-Language": locale() }),
                ...((v10?.body || body) && !(body instanceof FormData)
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(token
                    ? { Authorization: v10 ? `Bearer ${token}` : token }
                    : {}),
            },
            ...(v10
                ? v10.body
                    ? { body: v10.body }
                    : {}
                : body
                  ? {
                        body:
                            body instanceof FormData
                                ? body
                                : JSON.stringify(body),
                    }
                  : {}),
        });
        let json: Envelope<T>;
        try {
            json =
                res.status === 204
                    ? ({ data: true } as Envelope<T>)
                    : await res.json();
            if (v10 && !res.ok)
                Object.assign(json, {
                    message: (json as any).detail || (json as any).title,
                });
            if (v10 && res.ok && res.status !== 204) json = v10.decode(json);
        } catch {
            throw new Error(
                tx("服务响应异常 ({{value0}})", { value0: res.status }),
            );
        }
        if (!res.ok) {
            if (
                (res.status === 401 ||
                    (res.status === 403 &&
                        ["未登录或登陆已过期", "登录已过期"].includes(
                            json.message || "",
                        ))) &&
                token
            ) {
                readCache.clear();
                localStorage.removeItem(storageKey);
                window.dispatchEvent(new Event("auth-expired"));
            }
            const error = new Error(
                Object.values(json.errors || {})
                    .flat()
                    .join("；") ||
                    json.message ||
                    tx("请求失败 ({{value0}})", { value0: res.status }),
            );
            Object.assign(error, { code: json.code, status: res.status });
            throw error;
        }
        if (body && boot.mode === "user") {
            readCache.clear();
            window.dispatchEvent(new Event("data-changed"));
        }
        return json;
    } catch (error) {
        if (timedOut) throw new Error(tx("请求超时，请刷新确认结果后再试"));
        throw error;
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}
export function query(path: string, params: Row): string {
    const q = new URLSearchParams();
    function append(key: string, value: unknown) {
        if (value === "" || value == null) return;
        if (typeof value === "object")
            Object.entries(value).forEach(([k, v]) =>
                append(`${key}[${k}]`, v),
            );
        else q.append(key, String(value));
    }
    Object.entries(params).forEach(([k, v]) => append(k, v));
    return path + "?" + q;
}
export async function download(path: string, body: Row, filename: string) {
    const token = localStorage.getItem(storageKey);
    const response = await fetch(apiUrl(`/api/v1/${path}`), {
        credentials: "omit",
        method: "POST",
        headers: {
            Accept: "text/csv, application/json",
            "Content-Language": locale(),
            "Content-Type": "application/json",
            ...(token ? { Authorization: token } : {}),
        },
        body: JSON.stringify({ ...body, format: "csv" }),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (
            (response.status === 401 ||
                (response.status === 403 &&
                    ["未登录或登陆已过期", "登录已过期"].includes(
                        payload.message || "",
                    ))) &&
            token
        ) {
            readCache.clear();
            localStorage.removeItem(storageKey);
            window.dispatchEvent(new Event("auth-expired"));
        }
        throw new Error(
            Object.values(payload.errors || {})
                .flat()
                .join("；") ||
                payload.message ||
                tx("请求失败 ({{value0}})", { value0: response.status }),
        );
    }
    if (!response.headers.get("Content-Type")?.includes("text/csv"))
        throw new Error(tx("服务没有返回 CSV 文件"));
    const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function rows(data: unknown): Row[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object")
        return Object.values(data)
            .flat()
            .filter((x) => x && typeof x === "object");
    return [];
}
export const money = (n: unknown, currency = "CNY") =>
    `${currency} ${new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0) / 100)}`;
export const bytes = (n: unknown) => {
    let v = Number(n || 0),
        i = 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    while (v >= 1024 && i < 4) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(i ? 2 : 0)} ${units[i]}`;
};
export const date = (n: unknown) =>
    n ? new Date(Number(n) * 1000).toLocaleString(locale()) : "—";
export const navigate = (path: string) => {
    location.hash = "/" + path;
};
