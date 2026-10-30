import { localPreferences } from "./browser-storage";
import { tx } from "./i18n";
import { apiUrl } from "./runtime-config";
import { setDisplayTimeZone } from "./timezone";

const mode = () => window.V2BOARD.mode;
const legacyKey = () =>
    `v2board.${mode()}${window.V2BOARD.apiBaseUrl ? "." + encodeURIComponent(window.V2BOARD.apiBaseUrl) : ""}.auth`;
let csrfToken = "";
let authenticated = false;
let accountId: number | null = null;
export const browserSessionKey = () =>
    `${window.V2BOARD?.mode ?? "guest"}:${accountId ?? "guest"}`;
let pending: Promise<void> | undefined;
export const hasBrowserSession = () => authenticated;
const revisionKey = () => `v2board.${mode()}.sessionRevision`;
let observedRevision: string | null = null;
let invalidated = false;
let observing = false;
function changedSession(): never {
    setDisplayTimeZone(null);
    invalidated = true;
    authenticated = false;
    accountId = null;
    pending = undefined;
    window.dispatchEvent(new Event("auth-expired"));
    window.location.reload();
    throw Object.assign(new Error(tx("登录已过期")), { code: "SESSION_CHANGED" });
}
function observeSession() {
    if (observing) return;
    observing = true;
    window.addEventListener("storage", (event) => {
        if ((event.key === revisionKey() || event.key === null) &&
            localPreferences.getItem(revisionKey()) !== observedRevision) {
            // Storage events are external to this tab. Block old forms until reload.
            try { changedSession(); } catch { /* The active request also checks invalidation. */ }
        }
    });
}
function signalSessionChange() {
    if (invalidated) return;
    const revision = `${Date.now()}:${Math.random()}`;
    observedRevision = localPreferences.setItem(revisionKey(), revision)
        ? revision : localPreferences.getItem(revisionKey());
}
export function forgetBrowserSession() {
    setDisplayTimeZone(null);
    const changed = authenticated || accountId !== null;
    authenticated = false;
    accountId = null;
    if (changed) signalSessionChange();
}
export function queueBrowserLogout() {
    const persisted = localPreferences.setItem(`${legacyKey()}.pendingLogout`, "1");
    pending = undefined;
    if (!persisted) throw new Error(tx("退出未完成，请联网后重试。"));
}
export function acceptBrowserResponse(response: Response) {
    const next = response.headers.get("X-CSRF-Token");
    if (next) csrfToken = next;
}
async function sessionFetch(url: string, options: RequestInit, readJson = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        // Keep the deadline until metadata is consumed, not just until headers.
        const data = readJson && response.ok ? await response.json() : undefined;
        return { response, data };
    }
    catch (error) {
        if (controller.signal.aborted) throw new Error(tx("请求超时，请刷新确认结果后再试"));
        throw error;
    } finally { clearTimeout(timer); }
}
async function bootstrap() {
    observeSession();
    observedRevision = localPreferences.getItem(revisionKey());
    const { response, data: result } = await sessionFetch(apiUrl("/api/v10/auth/browser-session"), {
        credentials: "include",
        headers: { Accept: "application/json", "X-Browser-Client": mode() },
    }, true);
    if (!response.ok)
        throw new Error(
            tx("服务响应异常 ({{value0}})", { value0: response.status }),
        );
    if (invalidated) changedSession();
    const metadata = result?.data;
    if (!metadata || typeof metadata.csrfToken !== "string" || !metadata.csrfToken ||
        typeof metadata.authenticated !== "boolean" ||
        (metadata.authenticated && (!Number.isSafeInteger(metadata.accountId) || metadata.accountId < 1)))
        throw new Error(tx("服务响应异常 ({{value0}})", { value0: response.status }));
    csrfToken = metadata.csrfToken;
    authenticated = metadata.authenticated;
    accountId = authenticated ? metadata.accountId : null;
    if (localPreferences.getItem(`${legacyKey()}.pendingLogout`)) {
        authenticated = false;
        accountId = null;
        const { response: revoked } = await sessionFetch(apiUrl("/api/v10/auth/browser-session"), {
            method: "DELETE",
            credentials: "include",
            headers: {
                Accept: "application/json",
                "X-Browser-Client": mode(),
                "X-CSRF-Token": csrfToken,
            },
        });
        if (!revoked.ok)
            throw new Error(
                tx("服务响应异常 ({{value0}})", { value0: revoked.status }),
            );
        acceptBrowserResponse(revoked);
        localPreferences.removeItem(`${legacyKey()}.pendingLogout`);
        localPreferences.removeItem(legacyKey());
        authenticated = false;
        accountId = null;
    }
    // Delete obsolete JavaScript-readable credentials; never exchange or reuse them.
    try { localStorage.removeItem(legacyKey()); } catch { /* Storage may be blocked. */ }
}
export async function initializeBrowserSession() {
    if (invalidated) throw Object.assign(new Error(tx("登录已过期")), { code: "SESSION_CHANGED" });
    if (!pending)
        pending = bootstrap().catch((error) => {
            pending = undefined;
            authenticated = false;
            accountId = null;
            throw error;
        });
    await pending;
}
export async function browserHeaders() {
    await initializeBrowserSession();
    if (invalidated || localPreferences.getItem(revisionKey()) !== observedRevision) changedSession();
    return { "X-Browser-Client": mode(), "X-CSRF-Token": csrfToken };
}
export async function browserFetch(url: string, options: RequestInit = {}) {
    const mergeHeaders = (session: Record<string, string>) => {
        const headers = new Headers(options.headers);
        for (const [key, value] of Object.entries(session)) headers.set(key, value);
        return headers;
    };
    const headers = await browserHeaders();
    const identity = browserSessionKey();
    let response = await fetch(url, {
        ...options,
        credentials: "include",
        headers: mergeHeaders(headers),
    });
    acceptBrowserResponse(response);
    // 419 is returned before any business action; refresh stale CSRF after another tab signs in.
    if (response.status === 419) {
        pending = undefined;
        const fresh = await browserHeaders();
        if (browserSessionKey() !== identity) {
            changedSession();
        }
        response = await fetch(url, {
            ...options,
            credentials: "include",
            headers: mergeHeaders(fresh),
        });
        acceptBrowserResponse(response);
    }
    return response;
}
export function markBrowserAuthenticated(id?: number) {
    if (accountId !== (id ?? null)) setDisplayTimeZone(null);
    authenticated = true;
    accountId = id ?? null;
    signalSessionChange();
}
