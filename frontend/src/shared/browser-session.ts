import { tx } from "./i18n";
import { apiUrl } from "./runtime-config";

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
function signalSessionChange() {
    localStorage.setItem(
        `v2board.${mode()}.sessionRevision`,
        `${Date.now()}:${Math.random()}`,
    );
}
export function forgetBrowserSession() {
    authenticated = false;
    accountId = null;
    signalSessionChange();
}
export function queueBrowserLogout() {
    localStorage.setItem(`${legacyKey()}.pendingLogout`, "1");
    pending = undefined;
}
export function acceptBrowserResponse(response: Response) {
    const next = response.headers.get("X-CSRF-Token");
    if (next) csrfToken = next;
}
async function sessionFetch(url: string, options: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    catch (error) {
        if (controller.signal.aborted) throw new Error(tx("请求超时，请刷新确认结果后再试"));
        throw error;
    } finally { clearTimeout(timer); }
}
async function bootstrap() {
    const response = await sessionFetch(apiUrl("/api/v10/auth/browser-session"), {
        credentials: "include",
        headers: { Accept: "application/json", "X-Browser-Client": mode() },
    });
    if (!response.ok)
        throw new Error(
            tx("服务响应异常 ({{value0}})", { value0: response.status }),
        );
    const result = await response.json();
    csrfToken = result.data.csrfToken;
    authenticated = result.data.authenticated;
    accountId = result.data.accountId;
    if (localStorage.getItem(`${legacyKey()}.pendingLogout`)) {
        const revoked = await sessionFetch(apiUrl("/api/v10/auth/browser-session"), {
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
        localStorage.removeItem(`${legacyKey()}.pendingLogout`);
        localStorage.removeItem(legacyKey());
        authenticated = false;
        accountId = null;
    }
    const legacyToken = localStorage.getItem(legacyKey());
    if (legacyToken) {
        if (!authenticated) {
            const exchanged = await sessionFetch(
                apiUrl("/api/v10/auth/browser-session"),
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "X-Browser-Client": mode(),
                        "X-CSRF-Token": csrfToken,
                    },
                    body: JSON.stringify({ legacyToken }),
                },
            );
            if (exchanged.ok) {
                const migrated = await exchanged.json();
                csrfToken = migrated.data.csrfToken;
                authenticated = migrated.data.authenticated;
                accountId = migrated.data.accountId;
            } else if (![401, 403, 410].includes(exchanged.status)) {
                throw new Error(
                    tx("服务响应异常 ({{value0}})", {
                        value0: exchanged.status,
                    }),
                );
            }
        }
        localStorage.removeItem(legacyKey());
    }
}
export async function initializeBrowserSession() {
    if (!pending)
        pending = bootstrap().catch((error) => {
            pending = undefined;
            throw error;
        });
    await pending;
}
export async function browserHeaders() {
    await initializeBrowserSession();
    return { "X-Browser-Client": mode(), "X-CSRF-Token": csrfToken };
}
export async function browserFetch(url: string, options: RequestInit = {}) {
    const headers = await browserHeaders();
    let response = await fetch(url, {
        ...options,
        credentials: "include",
        headers: { ...options.headers, ...headers },
    });
    acceptBrowserResponse(response);
    // 419 is returned before any business action; refresh stale CSRF after another tab signs in.
    if (response.status === 419) {
        pending = undefined;
        const fresh = await browserHeaders();
        response = await fetch(url, {
            ...options,
            credentials: "include",
            headers: { ...options.headers, ...fresh },
        });
        acceptBrowserResponse(response);
    }
    return response;
}
export function markBrowserAuthenticated(id?: number) {
    authenticated = true;
    accountId = id ?? null;
    signalSessionChange();
}
