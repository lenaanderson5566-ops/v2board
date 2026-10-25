import { beforeEach, expect, it, vi } from "vitest";
const stored = new Map<string, string>();
vi.stubGlobal("window", { V2BOARD: { mode: "user" } });
vi.stubGlobal("document", { documentElement: { lang: "", dir: "" } });
vi.stubGlobal("navigator", { language: "en-US" });
const fakeStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
};
vi.stubGlobal("localStorage", fakeStorage);
const reply = (authenticated = false, csrfToken = "csrf", status = 200) =>
    new Response(
        JSON.stringify({
            data: {
                authenticated,
                csrfToken,
                accountId: authenticated ? 42 : null,
                expiresAt: null,
            },
        }),
        { status, headers: { "X-CSRF-Token": csrfToken } },
    );
beforeEach(() => {
    vi.resetModules();
    stored.clear();
    vi.stubGlobal("localStorage", fakeStorage);
    window.V2BOARD.mode = "user";
    window.dispatchEvent = vi.fn();
    window.addEventListener = vi.fn();
    Object.assign(window, {location:{reload:vi.fn()}});
});
it("bootstraps cookie metadata once and sends CSRF without Authorization", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(reply(true))
        .mockResolvedValueOnce(new Response('{"data":true}'));
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    await sessions.browserFetch("/api/v10/me", { method: "PATCH", body: "{}" });
    expect(sessions.hasBrowserSession()).toBe(true);
    expect(fetcher.mock.calls[1][1]).toMatchObject({
        credentials: "include",
    });
    expect(fetcher.mock.calls[1][1].headers.get("Authorization")).toBeNull();
    expect(fetcher.mock.calls[1][1].headers.get("X-CSRF-Token")).toBe("csrf");
    expect(stored.size).toBe(0);
});
it("deletes retired local credentials without sending them to the server", async () => {
    stored.set("v2board.user.auth", "legacy-secret");
    const fetcher = vi.fn().mockResolvedValue(reply());
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    await sessions.initializeBrowserSession();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("legacy-secret");
    expect(stored.size).toBe(0);
    expect(sessions.hasBrowserSession()).toBe(false);
});
it("refreshes a stale CSRF token and retries only after a pre-action rejection", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(reply(true))
        .mockResolvedValueOnce(reply(false, "ignored", 419))
        .mockResolvedValueOnce(reply(true, "fresh"))
        .mockResolvedValueOnce(new Response('{"data":true}'));
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    const result = await sessions.browserFetch("/api/v10/me", {
        method: "PATCH",
        body: "{}",
    });
    expect(result.ok).toBe(true);
    expect(fetcher.mock.calls[3][1].headers.get("X-CSRF-Token")).toBe("fresh");
});
it("uses a separate administrative scope", async () => {
    window.V2BOARD.mode = "admin";
    const fetcher = vi.fn().mockResolvedValue(reply(true));
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    expect(fetcher.mock.calls[0][1].headers["X-Browser-Client"]).toBe("admin");
    expect(sessions.browserSessionKey()).toBe("admin:42");
});

it("finishes a queued offline logout before restoring any authenticated UI", async () => {
    stored.set("v2board.user.auth.pendingLogout", "1");
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(reply(true))
        .mockResolvedValueOnce(
            new Response(null, {
                status: 204,
                headers: { "X-CSRF-Token": "anonymous" },
            }),
        );
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
    expect(sessions.hasBrowserSession()).toBe(false);
    expect(stored.has("v2board.user.auth.pendingLogout")).toBe(false);
});

it("cookie login and logout state work with blocked Web Storage", async () => {
    const blocked = () => { throw new DOMException("Blocked", "SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(true)));
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    expect(sessions.hasBrowserSession()).toBe(true);
    expect(() => sessions.markBrowserAuthenticated(42)).not.toThrow();
    await expect(sessions.browserFetch("/api/v10/me")).resolves.toHaveProperty("ok", true);
    expect(() => sessions.forgetBrowserSession()).not.toThrow();
    expect(sessions.hasBrowserSession()).toBe(false);
    // Offline logout must not pretend that revocation was durably queued.
    expect(() => sessions.queueBrowserLogout()).toThrow();
});
it("failed queued revocation never exposes an authenticated session", async () => {
    stored.set("v2board.user.auth.pendingLogout", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(new Response(null, {status:503})));
    const sessions = await import("./browser-session");
    await expect(sessions.initializeBrowserSession()).rejects.toThrow();
    expect(sessions.hasBrowserSession()).toBe(false);
    expect(stored.get("v2board.user.auth.pendingLogout")).toBe("1");
});
it.each([new Headers({"Content-Type":"application/json"}), [["Content-Type","application/json"]] as [string,string][]])("preserves caller headers across CSRF refresh", async (headers) => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(new Response(null,{status:419})).mockResolvedValueOnce(reply(true,"fresh")).mockResolvedValueOnce(new Response(null,{status:204}));
    vi.stubGlobal("fetch",fetcher);
    const sessions = await import("./browser-session");
    await sessions.browserFetch("/api/v10/me",{method:"PATCH",headers,body:"{}"});
    expect(fetcher.mock.calls[1][1].headers.get("Content-Type")).toBe("application/json");
    expect(fetcher.mock.calls[3][1].headers.get("Content-Type")).toBe("application/json");
    expect(fetcher.mock.calls[3][1].headers.get("X-CSRF-Token")).toBe("fresh");
});
it("language initialization and preference changes survive denied storage", async () => {
    const blocked = () => { throw new DOMException("Blocked", "SecurityError"); };
    vi.stubGlobal("localStorage", {getItem:blocked,setItem:blocked,removeItem:blocked});
    vi.stubGlobal("sessionStorage", {getItem:blocked,setItem:blocked,removeItem:blocked});
    try {
        const language = await import("./i18n");
        await language.languageReady;
        await language.changeLanguage("zh-CN");
        expect(language.locale()).toBe("zh-CN");
        expect(language.loginLanguagePreference().language_selected).toBe(true);
        await language.applyAccountLanguage("en-US");
        expect(language.locale()).toBe("en-US");
        expect(language.loginLanguagePreference().language_selected).toBe(false);
    } finally { vi.stubGlobal("sessionStorage", undefined); }
});

it("never replays an operation after CSRF refresh changes the account", async () => {
    const switched=new Response(JSON.stringify({data:{authenticated:true,csrfToken:"other",accountId:99}}));
    const fetcher=vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(new Response(null,{status:419})).mockResolvedValueOnce(switched);
    vi.stubGlobal("fetch",fetcher);
    const sessions=await import("./browser-session");
    await expect(sessions.browserFetch("/api/v10/me",{method:"PATCH",body:'{"email":"old-account@example.test"}'})).rejects.toMatchObject({code:"SESSION_CHANGED"});
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sessions.hasBrowserSession()).toBe(false);
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({type:"auth-expired"}));
});
it.each([{authenticated:"false",csrfToken:"token",accountId:42},{authenticated:true,csrfToken:"token",accountId:null},{authenticated:false,csrfToken:""}])("rejects malformed session metadata before submitting business requests",async(data)=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data})));
    vi.stubGlobal("fetch",fetcher);
    const sessions=await import("./browser-session");
    await expect(sessions.browserFetch("/api/v10/me",{method:"PATCH",body:"{}"})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sessions.hasBrowserSession()).toBe(false);
});

it("blocks old-tab submissions after another tab changes session revision",async()=>{
    const fetcher=vi.fn().mockResolvedValue(reply(true));vi.stubGlobal("fetch",fetcher);
    const sessions=await import("./browser-session");await sessions.initializeBrowserSession();
    stored.set("v2board.user.sessionRevision","other-tab");
    await expect(sessions.browserFetch("/api/v10/me",{method:"PATCH",body:"{}"})).rejects.toMatchObject({code:"SESSION_CHANGED"});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(window.location.reload).toHaveBeenCalledTimes(1);
    await expect(sessions.browserFetch("/api/v10/me",{method:"PATCH",body:"{}"})).rejects.toMatchObject({code:"SESSION_CHANGED"});
    expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reacts to cross-tab session changes without rebroadcasting another revision",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply(true)));
    const sessions=await import("./browser-session");await sessions.initializeBrowserSession();
    stored.set("v2board.user.sessionRevision","external");
    const listener=vi.mocked(window.addEventListener).mock.calls.find(([type])=>type==="storage")![1] as (event:any)=>void;
    listener({key:"v2board.user.sessionRevision"});
    expect(sessions.hasBrowserSession()).toBe(false);
    expect(stored.get("v2board.user.sessionRevision")).toBe("external");
    expect(window.location.reload).toHaveBeenCalledTimes(1);
});

it("does not cause a cross-tab reload loop when clearing an already anonymous session",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply(false)));
    const sessions=await import("./browser-session");await sessions.initializeBrowserSession();
    sessions.forgetBrowserSession();sessions.forgetBrowserSession();
    expect(stored.has("v2board.user.sessionRevision")).toBe(false);
    expect(window.location.reload).not.toHaveBeenCalled();
});
