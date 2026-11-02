import { beforeEach, expect, it, vi } from "vitest";
const stored = new Map<string, string>();
vi.stubGlobal("window", { FASTAI: { mode: "user" } });
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
    window.FASTAI.mode = "user";
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

it("times out stalled session metadata and allows a fresh initialization", async () => {
    vi.useFakeTimers();
    try {
        const fetcher = vi.fn().mockImplementationOnce((_url, options) => Promise.resolve({
            ok: true,
            json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
        })).mockResolvedValueOnce(reply(true));
        vi.stubGlobal("fetch", fetcher);
        const sessions = await import("./browser-session");
        const assertion = expect(sessions.initializeBrowserSession()).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(15000);
        await assertion;
        expect(sessions.hasBrowserSession()).toBe(false);
        await sessions.initializeBrowserSession();
        expect(sessions.hasBrowserSession()).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    } finally {
        vi.useRealTimers();
    }
});
it("deletes retired local credentials without sending them to the server", async () => {
    stored.set("v2board.user.auth", "legacy-secret");
    stored.set("fastai.user.auth", "obsolete-renamed-secret");
    const read = vi.fn(fakeStorage.getItem);
    vi.stubGlobal("localStorage", { ...fakeStorage, getItem: read });
    const fetcher = vi.fn().mockResolvedValue(reply());
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    const { localPreferences } = await import("./browser-storage");
    for (const key of ["fastai.user.auth", "v2board.user.auth"]) {
        expect(localPreferences.storageEvent({ key, newValue: null, storageArea: null }, key)).toBe("ignore");
    }
    await sessions.initializeBrowserSession();
    await sessions.initializeBrowserSession();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("legacy-secret");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("obsolete-renamed-secret");
    expect(read.mock.calls.map(([key]) => key)).not.toContain("v2board.user.auth");
    expect(read.mock.calls.map(([key]) => key)).not.toContain("fastai.user.auth");
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
    window.FASTAI.mode = "admin";
    const fetcher = vi.fn().mockResolvedValue(reply(true));
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    expect(fetcher.mock.calls[0][1].headers["X-Browser-Client"]).toBe("admin");
    expect(sessions.browserSessionKey()).toBe("admin:42");
});

it.each(["fastai", "v2board"])("finishes a queued %s offline logout before restoring any authenticated UI", async (prefix) => {
    stored.set(`${prefix}.user.auth.pendingLogout`, "1");
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
    expect(stored.has("fastai.user.auth.pendingLogout")).toBe(false);
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
    stored.set("fastai.user.auth.pendingLogout", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(new Response(null, {status:503})));
    const sessions = await import("./browser-session");
    await expect(sessions.initializeBrowserSession()).rejects.toThrow();
    expect(sessions.hasBrowserSession()).toBe(false);
    expect(stored.get("fastai.user.auth.pendingLogout")).toBe("1");
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

it.each(["fastai", "v2board"])("blocks submissions when either %s session revision changes",async(prefix)=>{
    stored.set("fastai.user.sessionRevision","original");
    stored.set("v2board.user.sessionRevision","original");
    const fetcher=vi.fn().mockResolvedValue(reply(true));vi.stubGlobal("fetch",fetcher);
    const sessions=await import("./browser-session");await sessions.initializeBrowserSession();
    stored.set(`${prefix}.user.sessionRevision`,"other-tab");
    await expect(sessions.browserFetch("/api/v10/me",{method:"PATCH",body:"{}"})).rejects.toMatchObject({code:"SESSION_CHANGED"});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(window.location.reload).toHaveBeenCalledTimes(1);
    await expect(sessions.browserFetch("/api/v10/me",{method:"PATCH",body:"{}"})).rejects.toMatchObject({code:"SESSION_CHANGED"});
    expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["fastai", "v2board"])("reacts to %s cross-tab session changes without rebroadcasting another revision",async(prefix)=>{
    stored.set("fastai.user.sessionRevision","original");
    stored.set("v2board.user.sessionRevision","original");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply(true)));
    const sessions=await import("./browser-session");await sessions.initializeBrowserSession();
    stored.set(`${prefix}.user.sessionRevision`,"external");
    const listener=vi.mocked(window.addEventListener).mock.calls.find(([type])=>type==="storage")![1] as (event:any)=>void;
    listener({key:`${prefix}.user.sessionRevision`});
    expect(sessions.hasBrowserSession()).toBe(false);
    expect(stored.get(`${prefix}.user.sessionRevision`)).toBe("external");
    expect(stored.get(`${prefix==='fastai'?'v2board':'fastai'}.user.sessionRevision`)).toBe("original");
    expect(window.location.reload).toHaveBeenCalledTimes(1);
});

it("signals authenticated changes to both generations and reports a failed durable logout write", async () => {
    const sessions=await import("./browser-session");
    sessions.markBrowserAuthenticated(42);
    expect(stored.get("fastai.user.sessionRevision")).toBeTruthy();
    expect(stored.get("v2board.user.sessionRevision")).toBe(stored.get("fastai.user.sessionRevision"));
    vi.stubGlobal("localStorage", {...fakeStorage,setItem:(key:string,value:string)=>{
        if(key.startsWith("fastai."))throw new DOMException("Full","QuotaExceededError");
        stored.set(key,value);
    }});
    const {tx}=await import("./i18n");
    expect(()=>sessions.queueBrowserLogout()).toThrow(tx("退出未完成，请联网后重试。"));
    expect(stored.get("v2board.user.auth.pendingLogout")).toBe("1");
});

it("reads a previous scoped preference without copying it to another account or site", async () => {
    const {localPreferences}=await import("./browser-storage");
    stored.set("v2board.admin.displayTimeZone.site.admin.42","Asia/Tokyo");
    expect(localPreferences.getItem("fastai.admin.displayTimeZone.site.admin.42")).toBe("Asia/Tokyo");
    expect(localPreferences.getItem("fastai.admin.displayTimeZone.site.admin.99")).toBeNull();
    expect(localPreferences.getItem("fastai.admin.displayTimeZone.other.admin.42")).toBeNull();
    expect(stored.has("fastai.admin.displayTimeZone.site.admin.42")).toBe(false);
});

it("observes a durable older-tab revision after a failed local write and storage recovery", async () => {
    let blocked=true;
    vi.stubGlobal("localStorage",{...fakeStorage,setItem:(key:string,value:string)=>{
        if(blocked)throw new DOMException("Full","QuotaExceededError");
        stored.set(key,value);
    }});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply(true)));
    const sessions=await import("./browser-session");
    await sessions.initializeBrowserSession();sessions.markBrowserAuthenticated(42);
    blocked=false;stored.set("v2board.user.sessionRevision","other-tab-after-recovery");
    const listener=vi.mocked(window.addEventListener).mock.calls.find(([type])=>type==="storage")![1] as (event:any)=>void;
    listener({key:"v2board.user.sessionRevision"});
    expect(sessions.hasBrowserSession()).toBe(false);
    await expect(sessions.browserHeaders()).rejects.toMatchObject({code:"SESSION_CHANGED"});
    expect(window.location.reload).toHaveBeenCalledOnce();
});

it("does not cause a cross-tab reload loop when clearing an already anonymous session",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply(false)));
    const sessions=await import("./browser-session");await sessions.initializeBrowserSession();
    sessions.forgetBrowserSession();sessions.forgetBrowserSession();
    expect(stored.has("fastai.user.sessionRevision")).toBe(false);
    expect(window.location.reload).not.toHaveBeenCalled();
});

it("clears the previous account's display zone when signing out or changing accounts", async () => {
    const sessions = await import("./browser-session");
    const zone = await import("./timezone");
    sessions.markBrowserAuthenticated(42);
    zone.setDisplayTimeZone("Asia/Shanghai");
    sessions.markBrowserAuthenticated(42);
    expect(zone.displayTimeZone()).toBe("Asia/Shanghai");
    sessions.markBrowserAuthenticated(99);
    expect(zone.displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    zone.setDisplayTimeZone("Asia/Tokyo");
    sessions.forgetBrowserSession();
    expect(zone.displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});
