import { finiteNumber, formatBytes, formatNumber } from "./number-format";
import { localPreferences } from "./browser-storage";
import {
    configureTimeZone,
    setDisplayTimeZone,
    formatInstant,
} from "./timezone";
import { observeApi } from "./telemetry";
import {
    browserFetch,
    browserSessionKey,
    queueBrowserLogout,
    forgetBrowserSession,
    hasBrowserSession,
    markBrowserAuthenticated,
} from "./browser-session";
import { apiUrl } from "./runtime-config";
import { v10Request } from "./v10-api";
import { createReadCache } from "./read-cache";
import { tx, locale } from "./i18n";
export type NodeBackendType = "v2box";
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
    systemTimeZone?: string;
    timeZones?: string[];
    fastaiDownloads?: import("./v10-types").V10FastaiRelease[];
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
    landingStyle?: "original" | "minimal";
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
    passkeyEnabled?: boolean;
    browserPolicies?: Partial<Record<"wechat" | "qq" | "weibo" | "xiaohongshu" | "douyin" | "bilibili" | "alipay" | "dingtalk" | "wecom" | "other", "allow" | "prompt" | "guide">>;
    tosUrl: string;
    currency?: "CNY";
    currencySymbol: string;
}
declare global {
    interface Window {
        V2BOARD: Boot;
    }
}
export const boot = window.V2BOARD;
configureTimeZone(
    boot.systemTimeZone || "Asia/Shanghai",
    boot.mode === "admin",
);
export const storageKey = `v2board.${boot.mode}${boot.apiBaseUrl ? "." + encodeURIComponent(boot.apiBaseUrl) : ""}.auth`;
export const admin = (path: string) => `${boot.adminPath}/${path}`;
export const ops = (path: string) => `${boot.opsPath}/${path}`;
const readCache = createReadCache();
let accountSettingsGeneration = 0;
let accountReadSequence = 0;
let appliedAccountReadSequence = 0;
const cacheable = new Set([
    "user/info",
    "user/getSubscribe",
    "user/notice/fetch",
    "user/server/fetch",
    "user/coupon/wallet",
]);
export function readRequest<T = Row>(
    path: string,
    body?: Row,
    fresh = false,
): Promise<Envelope<T>> {
    if (boot.mode !== "user" || body || !cacheable.has(path))
        return request<T>(path, body);
    return readCache.read(
        `${browserSessionKey()}\0${localPreferences.getItem(`v2board.${boot.mode}.sessionRevision`) || ""}\0${locale()}\0${path}`,
        () => request<T>(path),
        fresh,
    );
}
export function clearReadCache() {
    accountSettingsGeneration++;
    readCache.clear();
}
export async function logoutSession() {
    try {
        const response = await browserFetch(
            apiUrl("/api/v10/auth/browser-session"),
            { method: "DELETE" },
        );
        if (!response.ok) throw new Error("Session revocation failed");
    } catch {
        queueBrowserLogout();
    } finally {
        clearReadCache();
        forgetBrowserSession();
    }
}
/** Normalize untrusted JSON errors from both V10 problems and legacy envelopes. */
function apiFailure(payload: unknown, status: number, authenticated: boolean, problem = false, retryHeader?: string | null): Error {
    const fields = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : {};
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const message = (problem ? text(fields.detail) || text(fields.title) : "") || text(fields.message);
    const errors = fields.errors !== null && typeof fields.errors === "object" && !Array.isArray(fields.errors)
        ? Object.values(fields.errors).flat().filter((value): value is string => typeof value === "string") : [];
    if (authenticated && (status === 401 || (status === 403 && ["未登录或登陆已过期", "登录已过期"].includes(message)))) {
        clearReadCache();
        forgetBrowserSession();
        window.dispatchEvent(new Event("auth-expired"));
    }
    const delay = retryHeader && /^\d+$/.test(retryHeader.trim())
        ? Number(retryHeader) : retryHeader ? Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000) : NaN;
    return Object.assign(new Error(status === 429 ? tx("操作过于频繁，请稍后重试。") : errors.join("；") || message || tx("请求失败 ({{value0}})", { value0: status })), {
        code: text(fields.code) || undefined, status,
        ...(status === 429 ? { retryAfter: Number.isFinite(delay) ? Math.max(1, delay) : 60 } : {}),
    });
}
export async function request<T = Row>(
    path: string,
    body?: Row | FormData,
    options?: { signal?: AbortSignal; timeoutMs?: number; method?: "PATCH" },
): Promise<Envelope<T>> {
    const observedStart=performance.now();
    let observedFailure: "api_error" | "network_error" | null = null;
    // Checkout quotes use POST for structured input, but do not mutate account data.
    const readOnly = path.split("?")[0] === "user/order/quote";
    if (body && !readOnly) clearReadCache();
    const token = hasBrowserSession();
    const requestMode = boot.mode;
    const identity = browserSessionKey();
    const sessionRevision = localPreferences.getItem(`v2board.${requestMode}.sessionRevision`);
    const settingsGeneration = accountSettingsGeneration;
    const accountRead = path.split("?")[0] === "user/info" ? ++accountReadSequence : 0;
    const sameSession = () => boot.mode === requestMode && browserSessionKey() === identity &&
        hasBrowserSession() === token &&
        localPreferences.getItem(`v2board.${requestMode}.sessionRevision`) === sessionRevision;
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
            (boot.mode === "user" || path === "user/info") && /^(user|passport|guest)\//.test(path)
                ? v10Request(path, body instanceof FormData ? undefined : body)
                : null;
        const res = await browserFetch(apiUrl(v10?.url ?? `/api/v1/${path}`), {
            credentials: "include",
            signal: controller.signal,
            method: v10?.method ?? options?.method ?? (body ? "POST" : "GET"),
            headers: {
                Accept: "application/json",
                ...(v10
                    ? { "Accept-Language": locale() }
                    : { "Content-Language": locale() }),
                ...((v10?.body || body) && !(body instanceof FormData)
                    ? { "Content-Type": "application/json" }
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
        }).catch((error: unknown) => {
            observedFailure="network_error";
            if (error instanceof TypeError && !controller.signal.aborted) {
                throw Object.assign(
                    new Error(tx("网络连接中断，请检查网络后确认操作结果")),
                    { code: "NETWORK_ERROR" },
                );
            }
            throw error;
        });
        let json: Envelope<T>;
        if (!res.ok) observedFailure="api_error";
        try {
            json =
                res.status === 204
                    ? ({ data: true } as Envelope<T>)
                    : await res.json();
            if (v10 && res.ok && res.status !== 204) json = v10.decode(json);
        } catch {
            observedFailure="api_error";
            if (!res.ok) throw apiFailure(undefined, res.status, token, Boolean(v10), res.headers.get("Retry-After"));
            throw new Error(
                tx("服务响应异常 ({{value0}})", { value0: res.status }),
            );
        }
        if (!res.ok) throw apiFailure(json, res.status, token, Boolean(v10), res.headers.get("Retry-After"));
        if (
            json.data &&
            typeof json.data === "object" &&
            (json.data as Row).authenticated === true
        )
            markBrowserAuthenticated((json.data as Row).accountId);
        if (body && !readOnly && boot.mode === "user" && path !== "passport/mfa/verifications") {
            clearReadCache();
            // Apply a confirmed preference before readers react to data-changed.
            // Earlier account snapshots and callbacks from another session must
            // not restore the old display zone after a successful save.
            if (path === "user/update" && !(body instanceof FormData) &&
                Object.hasOwn(body, "display_timezone") && sameSession())
                setDisplayTimeZone(body.display_timezone);
            window.dispatchEvent(new Event("data-changed"));
        }
        if (accountRead && json.data && sameSession() &&
            accountRead > appliedAccountReadSequence && settingsGeneration === accountSettingsGeneration) {
            appliedAccountReadSequence = accountRead;
            const account = json.data as Row;
            configureTimeZone(
                account.system_timezone ||
                    boot.systemTimeZone ||
                    "Asia/Shanghai",
                boot.mode === "admin",
            );
            setDisplayTimeZone(account.display_timezone);
        }
        return json;
    } catch (error) {
        if (timedOut)
            throw Object.assign(
                new Error(tx("请求超时，请刷新确认结果后再试")),
                { code: "REQUEST_TIMEOUT" },
            );
        throw error;
    } finally {
        if (boot.mode === "user" && !options?.signal?.aborted) observeApi({duration: performance.now()-observedStart, failure: observedFailure});
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
    const token = hasBrowserSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await browserFetch(apiUrl(`/api/v1/${path}`), {
            signal: controller.signal,
            credentials: "include",
            method: "POST",
            headers: {
                Accept: "text/csv, application/json",
                "Content-Language": locale(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...body, format: "csv" }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw apiFailure(payload, response.status, token);
        }
        if (!response.headers.get("Content-Type")?.includes("text/csv"))
            throw new Error(tx("服务没有返回 CSV 文件"));
        const url = URL.createObjectURL(await response.blob()),
            link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        try {
            link.click();
        } finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    } catch (error) {
        if (controller.signal.aborted)
            throw Object.assign(
                new Error(tx("请求超时，请刷新确认结果后再试")),
                { code: "REQUEST_TIMEOUT" },
            );
        if (error instanceof TypeError)
            throw Object.assign(
                new Error(tx("网络连接中断，请检查网络后确认操作结果")),
                { code: "NETWORK_ERROR" },
            );
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
export function rows(data: unknown): Row[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object")
        return Object.values(data)
            .flat()
            .filter((x) => x && typeof x === "object");
    return [];
}
export const money = (value: unknown, currency = "CNY") => {
    const amount = finiteNumber(value);
    if (amount === null) return "—";
    // Explicit ISO codes distinguish account and settlement currencies.
    return `${currency} ${formatNumber(amount / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const bytes = formatBytes;
export const date = (value: unknown, options: Intl.DateTimeFormatOptions = {}): string => {
    const text = typeof value === "string" ? value.trim() : "";
    const numeric = text && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
    // Legacy numeric values are Unix seconds; strings must carry an explicit
    // zone so the browser's local parser cannot silently choose a different instant.
    const instant = value instanceof Date || typeof value === "number" ? value
        : numeric ? Number(text)
        : /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(text) ? text : null;
    return instant === null ? "—" : formatInstant(instant, { ...options, ...(boot.mode === "admin" ? { timeZoneName: undefined } : {}) });
};
export const navigate = (path: string) => {
    location.hash = "/" + path;
};
