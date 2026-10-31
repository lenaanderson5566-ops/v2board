import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";

const session = vi.hoisted(() => ({ active: true, identity: "user:42", forgotten: vi.fn() }));
vi.mock("./browser-session", () => ({
    queueBrowserLogout: vi.fn(),
    browserSessionKey: () => session.identity,
    browserFetch: (url: string, options: RequestInit = {}) => fetch(url, { ...options, credentials: "include", headers: { ...options.headers, "X-Browser-Client": "user", "X-CSRF-Token": "csrf-test" } }),
    hasBrowserSession: () => session.active,
    forgetBrowserSession: () => { session.active = false; session.forgotten(); },
    markBrowserAuthenticated: () => { session.active = true; },
}));
vi.stubGlobal("window", {
    V2BOARD: { mode: "user", currencySymbol: "¥" },
    dispatchEvent: vi.fn(),
});
vi.stubGlobal("document", { documentElement: { lang: "", dir: "" } });
vi.stubGlobal("navigator", { language: "zh-CN" });
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) || null,
    removeItem: (key: string) => storage.delete(key),
});
const {
    request,
    rows,
    query,
    bytes,
    storageKey,
    download,
    logoutSession,
    money,
    date,
} = await import("./api");
const { prepareWorkspaceLanguage } = await import("./i18n");
const { configureTimeZone, displayTimeZone, dateTimeInput, setDisplayTimeZone } = await import("./timezone");
// Business requests normally run only after the admitted workspace's language is ready.
beforeAll(async () => { await prepareWorkspaceLanguage(); });
describe("API client", () => {
    it("labels amounts CNY regardless of the legacy boot symbol", () => {
        expect(money(2880)).toBe("CNY 28.80");
        expect(money(-1234)).toBe("CNY -12.34");
        expect(money(0)).toBe("CNY 0.00");
        expect(money(123456, "USD")).toBe("USD 1,234.56");
        expect(money(-0)).toBe("CNY 0.00");
        expect(money(NaN)).toBe("—");
        expect(money(Infinity)).toBe("—");
    });
    it("keeps order currency in the frontend decoder", async () => {
        storage.set(storageKey, "session-token");
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            data: {
                                orderNumber: "cny-history",
                                totalAmount: 2880,
                                currency: "CNY",
                            },
                        }),
                        { status: 200 },
                    ),
                ),
        );
        const result = await request<any>(
            "user/order/detail?trade_no=cny-history",
        );
        expect(result.data.currency).toBe("CNY");
        expect(result.data.total_amount).toBe(2880);
    });
    it("revokes the current server session before clearing the browser token", async () => {
        storage.set(storageKey, "session-token");
        const fetchMock = vi
            .fn()
            .mockResolvedValue(new Response('{"data":true}', { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await logoutSession();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v10/auth/browser-session");
        expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(session.active).toBe(false);
    });
    it("allows local logout when offline", async () => {
        storage.set(storageKey, "session-token");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("offline")));
        await logoutSession();
        expect(session.active).toBe(false);
    });
    beforeEach(() => {
        storage.clear();
        session.active = true;
        vi.restoreAllMocks();
    });
    it("sends authenticated JSON without leaking credentials into URL", async () => {
        storage.set(storageKey, "session-token");
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: true }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchMock);
        await request("user/update", { remind_expire: 1, remind_service: false, announcement_email: true });
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v10/me");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe(
            "zh-CN",
        );
        expect(fetchMock.mock.calls[0][1].body).toBe('{"expiryReminders":1,"serviceNotifications":false,"announcementEmails":true}');
    });
    it("clears expired sessions and reports access errors", async () => {
        storage.set(storageKey, "expired");
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response('{"detail":"登录已过期"}', { status: 401 }),
                ),
        );
        await expect(request("user/info")).rejects.toThrow("登录已过期");
        expect(session.active).toBe(false);
    });
    it.each([null, [], 7, "proxy failure", { message: { unsafe: "object" }, errors: { email: [null, {}, "邮箱错误"] } }])("normalizes malformed error responses without exposing objects: %j", async (payload) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 422 })));
        const failure = await request("user/info").catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).toMatchObject({ status: 422 });
        expect((failure as Error).message).not.toContain("[object Object]");
        expect(session.active).toBe(true);
    });
    it("invalidates an expired session even when its error body is null", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 401 })));
        await expect(request("user/info")).rejects.toMatchObject({ status: 401 });
        expect(session.active).toBe(false);
    });
    it.each([401, 503])("preserves HTTP status for a non-JSON proxy error: %i", async (status) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>proxy error</html>", { status })));
        await expect(request("user/info")).rejects.toMatchObject({ status });
        expect(session.active).toBe(status !== 401);
    });
    it("uses the same safe error handling for CSV failures", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 401 })));
        await expect(download("admin/coupon/generate", {}, "coupons.csv")).rejects.toMatchObject({ status: 401 });
        expect(session.active).toBe(false);
    });
    it("reports server validation details", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response('{"errors":{"email":["邮箱格式错误"]}}', {
                    status: 422,
                }),
            ),
        );
        await expect(
            request("passport/auth/login", { email: "invalid" }),
        ).rejects.toThrow("邮箱格式错误");
    });
    it("handles non-JSON server failures", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response("<html>Error</html>", { status: 500 }),
                ),
        );
        await expect(request("user/info")).rejects.toThrow("500");
    });
    it("encodes filters and omits empty values", () => {
        expect(query("log", { email: "a+b@test.com", ip: "", id: null })).toBe(
            "log?email=a%2Bb%40test.com",
        );
    });
    it("normalizes grouped collections and traffic values", () => {
        expect(rows({ 教程: [{ id: 1 }], 帮助: [{ id: 2 }] })).toEqual([
            { id: 1 },
            { id: 2 },
        ]);
        expect(bytes(1073741824)).toBe("1 GiB");
        expect(rows(null)).toEqual([]);
    });
});

it("encodes nested PHP filter arrays and preserves zero", () => {
    const params = new URLSearchParams(
        query("admin/user/fetch", {
            filter: [{ key: "banned", condition: "=", value: 0 }],
            sort: "id",
        }).split("?")[1],
    );
    expect(params.get("filter[0][key]")).toBe("banned");
    expect(params.get("filter[0][value]")).toBe("0");
    expect(params.get("sort")).toBe("id");
});

describe("CSV download", () => {
    it("rejects successful JSON responses instead of saving a false CSV", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ data: true }), {
                    headers: { "Content-Type": "application/json" },
                }),
            ),
        );
        await expect(
            download("admin/coupon/generate", {}, "coupons.csv"),
        ).rejects.toThrow("CSV");
    });
    it("sends filters with authentication and downloads the returned CSV", async () => {
        storage.set(storageKey, "csv-session");
        const click = vi.fn(),
            remove = vi.fn(),
            link = { href: "", download: "", click, remove };
        vi.stubGlobal("document", {
            documentElement: { lang: "", dir: "" },
            createElement: () => link,
            body: { append: vi.fn() },
        });
        const create = vi
            .spyOn(URL, "createObjectURL")
            .mockReturnValue("blob:test");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const fetchMock = vi.fn().mockResolvedValue(
            new Response("email\nuser@example.com", {
                headers: { "Content-Type": "text/csv; charset=UTF-8" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);
        await download(
            "admin/coupon/generate",
            { filter: [{ key: "banned", condition: "=", value: 0 }] },
            "coupons.csv",
        );
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(
            JSON.parse(fetchMock.mock.calls[0][1].body).filter[0].value,
        ).toBe(0);
        expect(create).toHaveBeenCalled();
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).format).toBe("csv");
        expect(link.download).toBe("coupons.csv");
        expect(click).toHaveBeenCalled();
        expect(remove).toHaveBeenCalled();
    });
});

it("sends multipart uploads without overriding the browser boundary", async () => {
    storage.set(storageKey, "upload-session");
    const fetchMock = vi
        .fn()
        .mockResolvedValue(
            new Response('{"data":{"url":"/image.png"}}', { status: 200 }),
        );
    vi.stubGlobal("fetch", fetchMock);
    const body = new FormData();
    body.append(
        "image",
        new Blob(["png"], { type: "image/png" }),
        "banner.png",
    );
    await request("admin/banner/upload", body);
    const options = fetchMock.mock.calls[0][1];
    expect(options.body).toBe(body);
    expect(options.headers["Content-Type"]).toBeUndefined();
    expect(options.headers.Authorization).toBeUndefined();
});

it("keeps the session on ordinary permission denial", async () => {
    storage.set(storageKey, "valid");
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValue(
                new Response('{"message":"Forbidden"}', { status: 403 }),
            ),
    );
    await expect(request("user/info")).rejects.toMatchObject({ status: 403 });
    expect(storage.get(storageKey)).toBe("valid");
});
it("times out stalled requests", async () => {
    vi.useFakeTimers();
    try {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url, options) =>
                    new Promise((_resolve, reject) => {
                        options.signal.addEventListener("abort", () =>
                            reject(new DOMException("Aborted", "AbortError")),
                        );
                    }),
            ),
        );
        const assertion = expect(
            request("user/info", undefined, { timeoutMs: 100 }),
        ).rejects.toThrow("请求超时");
        await vi.advanceTimersByTimeAsync(100);
        await assertion;
    } finally {
        vi.useRealTimers();
    }
});

it.each(["headers", "body"])("times out stalled CSV %s without replaying export", async (stage) => {
    vi.useFakeTimers();
    try {
        const fetcher = vi.fn((_url, options) => {
            const stalled = () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
            return stage === "headers" ? stalled() : Promise.resolve({ok:true,headers:new Headers({"Content-Type":"text/csv"}),blob:stalled});
        });
        vi.stubGlobal("fetch", fetcher);
        const assertion = expect(download("admin/coupon/generate", {}, "coupons.csv")).rejects.toMatchObject({code:"REQUEST_TIMEOUT"});
        await vi.advanceTimersByTimeAsync(60000);
        await assertion;
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    } finally {
        vi.useRealTimers();
    }
});

it("uses the configured backend origin for authenticated API calls with scoped cookies", async () => {
    window.V2BOARD.apiBaseUrl = "https://api.example.com";
    const fetcher = vi
        .fn()
        .mockResolvedValue(
            new Response(JSON.stringify({ data: {} }), { status: 200 }),
        );
    vi.stubGlobal("fetch", fetcher);
    try {
        await request("user/info");
        expect(fetcher.mock.calls[0][0]).toBe(
            "https://api.example.com/api/v10/me",
        );
        expect(fetcher.mock.calls[0][1].credentials).toBe("include");
    } finally {
        delete window.V2BOARD.apiBaseUrl;
    }
});

it("accepts browser login metadata without expecting a bearer token", async () => {
    session.active = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { accountId: 42, authenticated: true, csrfToken: "fresh", expiresAt: "2026-11-01T00:00:00Z" } }), { status: 200 })));
    const result = await request("passport/auth/login", { email: "test@example.com", password: "example" });
    expect(result.data.authenticated).toBe(true);
    expect(result.data.auth_data).toBeUndefined();
    expect(session.active).toBe(true);
});

it("normalizes browser network failures without retrying the request", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetcher);
    await expect(request("user/info")).rejects.toMatchObject({ code: "NETWORK_ERROR", message: "网络连接中断，请检查网络并确认操作结果。" });
    expect(fetcher).toHaveBeenCalledTimes(1);
});

it("maps private ticket notification receipts to their explicit V10 route",async()=>{
 session.active=true;
 const send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal("fetch",send);
 await request("user/notice/readTicket",{id:42,version:7});
 expect(send.mock.calls[0][0]).toBe("/api/v10/me/notifications/ticket-read-receipts");
 expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ticketId:42,version:7});
});

it("loads administrator account identity from the retained V10 account endpoint",async()=>{
 window.V2BOARD.mode="admin";session.active=true;
 const send=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{id:42,email:"admin@example.test"}}),{status:200}));vi.stubGlobal("fetch",send);
 try{await request("user/info");expect(send.mock.calls[0][0]).toBe("/api/v10/me");}finally{window.V2BOARD.mode="user";}
});

it("uses PATCH for narrow administrative edits while retaining browser session handling",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:true}),{status:200}));vi.stubGlobal("fetch",fetchMock);
    await request("test-admin/server/connections/default",{id:3,name:"JP"},{method:"PATCH"});
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/test-admin/server/connections/default"),expect.objectContaining({method:"PATCH",credentials:"include",body:JSON.stringify({id:3,name:"JP"})}));
});

it("separates in-memory account reads even when Web Storage cannot persist a revision",async()=>{
    const {readRequest,clearReadCache}=await import("./api");
    clearReadCache();
    const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({data:{id:session.identity,email:session.identity}})));
    vi.stubGlobal("fetch",fetcher);
    session.identity="user:42";
    const first=await readRequest("user/info");
    session.identity="user:99";
    const second=await readRequest("user/info");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.data.email).not.toBe(second.data.email);
    session.identity="user:42";clearReadCache();
});

it("does not invalidate wallet reads or broadcast changes for a read-only checkout quote", async () => {
    const { readRequest, clearReadCache } = await import("./api");
    clearReadCache();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({
        data: url.includes("checkout-quotes") ? {} : [],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await readRequest("user/coupon/wallet");
    const before = (window.dispatchEvent as any).mock.calls.length;
    await request("user/order/quote", { plan_id: 1, period: "month_price", quote_method: 0 });
    await readRequest("user/coupon/wallet");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((window.dispatchEvent as any).mock.calls.slice(before).some(([event]: [Event]) => event.type === "data-changed")).toBe(false);
    clearReadCache();
});
it.each(["seconds", "date"])("preserves server rate-limit cooldown from Retry-After %s", async (format) => {
    const retryAfter = format === "seconds" ? "7" : new Date(Date.now() + 7000).toUTCString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Too Many Attempts.", code: "RATE_LIMITED" }), {
        status: 429, headers: { "Retry-After": retryAfter },
    })));
    const failure = await request("user/coupon/wallet").catch(error => error);
    expect(failure.status).toBe(429);
    expect(failure.code).toBe("RATE_LIMITED");
    expect(failure.retryAfter).toBeGreaterThan(0);
    expect(failure.retryAfter).toBeLessThanOrEqual(7);
    expect(failure.message).not.toContain("Too Many Attempts");
});

describe("account display time zone", () => {
    beforeEach(async () => {
        window.V2BOARD.mode = "user";
        session.active = true;
        session.identity = "user:42";
        storage.clear();
        configureTimeZone("UTC");
        setDisplayTimeZone("Asia/Shanghai");
        const { clearReadCache } = await import("./api");
        clearReadCache();
    });
    afterEach(() => {
        window.V2BOARD.mode = "user";
        session.active = true;
        session.identity = "user:42";
        setDisplayTimeZone(null);
        storage.clear();
        vi.mocked(window.dispatchEvent).mockReset();
    });
    const accountReply = (zone: string | null) => new Response(JSON.stringify({
        data: { id: 42, displayTimeZone: zone, systemTimeZone: "UTC" },
    }), { status: 200 });
    it("formats Unix seconds, zoned ISO timestamps and Date objects in the personal zone", () => {
        const iso = "2026-11-30T00:00:00Z";
        const seconds = Date.parse(iso) / 1000;
        expect(date(iso)).toBe(date(seconds));
        expect(date(String(seconds))).toBe(date(seconds));
        expect(date(new Date(iso))).toBe(date(seconds));
        expect(date("2026-11-30T08:00:00+08:00")).toBe(date(seconds));
        expect(date(iso)).toContain("08:00:00");
        setDisplayTimeZone("UTC");
        expect(date(iso)).toContain("00:00:00");
        expect(date(0)).not.toBe("—");
        for (const value of [null, undefined, "", "  ", false, {}, "2026-11-30", "2026-11-30 08:00:00", "2026-11-30T08:00:00", "invalid", Infinity, Number.MAX_VALUE])
            expect(date(value)).toBe("—");
    });
    it("restores an explicit UTC preference on fresh account loads and preserves the reset instant", async () => {
        const resetAt = "2026-11-30T00:00:00Z";
        vi.stubGlobal("fetch", vi.fn()
            .mockResolvedValueOnce(accountReply("UTC"))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { resetAt, resetTimezone: "UTC" } })))
            .mockResolvedValueOnce(accountReply("UTC")));
        await request("user/info");
        expect(displayTimeZone()).toBe("UTC");
        const subscription = await request<any>("user/getSubscribe");
        expect(subscription.data.reset_at).toBe(Date.parse(resetAt) / 1000);
        expect(dateTimeInput(subscription.data.reset_at)).toBe("2026-11-30T00:00");
        setDisplayTimeZone(null); // Recreate a fresh login's unset display preference.
        await request("user/info");
        expect(displayTimeZone()).toBe("UTC");
        expect(dateTimeInput(subscription.data.reset_at)).toBe("2026-11-30T00:00");
    });
    it("applies a confirmed setting before notifying readers and preserves null for following the device", async () => {
        const sent = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
        vi.stubGlobal("fetch", sent);
        const observed: string[] = [];
        vi.mocked(window.dispatchEvent).mockImplementation((event) => {
            if (event.type === "data-changed") observed.push(displayTimeZone());
            return true;
        });
        await request("user/update", { display_timezone: "UTC" });
        expect(observed).toEqual(["UTC"]);
        expect(sent.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: '{"displayTimeZone":"UTC"}' });
        await request("user/update", { display_timezone: null });
        expect(displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        expect(JSON.parse(sent.mock.calls[1][1].body)).toEqual({ displayTimeZone: null });
    });
    it("retains the current preference when saving fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"unavailable"}', { status: 503 })));
        await expect(request("user/update", { display_timezone: "UTC" })).rejects.toMatchObject({ status: 503 });
        expect(displayTimeZone()).toBe("Asia/Shanghai");
    });
    it("does not let a late account body overwrite a newly saved UTC preference", async () => {
        let finish!: (value: unknown) => void;
        const json = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        vi.stubGlobal("fetch", vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json })
            .mockResolvedValueOnce(new Response(null, { status: 204 })));
        const older = request("user/info");
        await vi.waitFor(() => expect(json).toHaveBeenCalled());
        await request("user/update", { display_timezone: "UTC" });
        finish({ data: { id: 42, displayTimeZone: "Asia/Shanghai", systemTimeZone: "UTC" } });
        await older;
        expect(displayTimeZone()).toBe("UTC");
    });
    it.each(["identity", "revision"])("ignores an account snapshot after its session %s changes", async (changed) => {
        let finish!: (value: unknown) => void;
        const json = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json }));
        const older = request("user/info");
        await vi.waitFor(() => expect(json).toHaveBeenCalled());
        if (changed === "identity") session.identity = "user:99";
        else storage.set("v2board.user.sessionRevision", "new-login");
        setDisplayTimeZone("UTC");
        finish({ data: { displayTimeZone: "Asia/Shanghai", systemTimeZone: "UTC" } });
        await older;
        expect(displayTimeZone()).toBe("UTC");
    });
    it("ignores a completed preference save from a previous account", async () => {
        let finish!: (response: Response) => void;
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
        const older = request("user/update", { display_timezone: "Asia/Tokyo" });
        session.identity = "user:99";
        setDisplayTimeZone("UTC");
        finish(new Response(null, { status: 204 }));
        await older;
        expect(displayTimeZone()).toBe("UTC");
    });
    it("keeps a newer account read when an earlier response finishes last", async () => {
        let finish!: (value: unknown) => void;
        const json = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        vi.stubGlobal("fetch", vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json })
            .mockResolvedValueOnce(accountReply("UTC")));
        const older = request("user/info");
        await vi.waitFor(() => expect(json).toHaveBeenCalled());
        await request("user/info");
        finish({ data: { displayTimeZone: "Asia/Shanghai", systemTimeZone: "UTC" } });
        await older;
        expect(displayTimeZone()).toBe("UTC");
    });
    it("keeps administrator dates in the business zone when reading account identity", async () => {
        window.V2BOARD.mode = "admin";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(accountReply("Asia/Shanghai")));
        await request("user/info");
        expect(displayTimeZone()).toBe("UTC");
    });
});

describe("quantity display boundaries", () => {
    it("uses binary units, trims display zeros, and carries rounded unit boundaries", () => {
        expect(bytes(0)).toBe("0 B");
        expect(bytes(1024)).toBe("1 KiB");
        expect(bytes(1536)).toBe("1.5 KiB");
        expect(bytes(50 * 1024 ** 3)).toBe("50 GiB");
        expect(bytes(1024 ** 3 - 1)).toBe("1 GiB");
        for (const value of [null, undefined, "", false, NaN, Infinity, -1]) expect(bytes(value)).toBe("—");
    });
    it("preserves small nonzero percentages and multipliers instead of reporting zero or full quota", async () => {
        const { formatNumber, formatPercent, formatMultiplier, formatDuration } = await import("./number-format");
        expect(formatPercent(0)).toBe("0%");
        expect(formatPercent(0.01)).toBe("<0.1%");
        expect(formatPercent(99.99, { bounded: true })).toBe(">99.9%");
        expect(formatPercent(100, { bounded: true })).toBe("100%");
        expect(formatPercent(0.1 - 1e-14)).toBe("0.1%");
        expect(formatPercent(99.9 + 1e-14, { bounded: true })).toBe("99.9%");
        expect(formatNumber(-0.001)).toBe("0");
        expect(money(-0.1)).toBe("CNY 0.00");
        expect(formatDuration(0)).toBe("0 ms");
        expect(formatDuration(0.04)).toBe("<0.1 ms");
        expect(formatDuration(0.04, "s")).toBe("<0.1 s");
        expect(formatDuration(12.34, "s")).toBe("12.3 s");
        expect(formatDuration(-1)).toBe("—");
        expect(formatPercent(0.125, { fraction: true })).toBe("12.5%");
        expect(formatPercent(10, { maximumFractionDigits: 0 })).toBe("10%");
        expect(formatMultiplier(0.00001)).toBe("0.00001×");
        expect(formatMultiplier(1e-12)).toBe("<0.000000001×");
        expect(formatMultiplier(0)).toBe("0×");
        expect(formatMultiplier(-1)).toBe("—");
        for (const value of [null, "", false, NaN, Infinity]) {
            expect(formatNumber(value)).toBe("—");
            expect(formatPercent(value)).toBe("—");
            expect(money(value)).toBe("—");
        }
        expect(formatNumber(1234.5001)).toBe("1,234.5");
        expect(money(123450, "USD")).toBe("USD 1,234.50");
    });
});
