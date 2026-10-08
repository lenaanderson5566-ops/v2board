import { beforeEach, describe, it, expect, vi } from "vitest";

const session = vi.hoisted(() => ({ active: true, forgotten: vi.fn() }));
vi.mock("./browser-session", () => ({
    queueBrowserLogout: vi.fn(),
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
} = await import("./api");
describe("API client", () => {
    it("labels amounts CNY regardless of the legacy boot symbol", () => {
        expect(money(2880)).toBe("CNY 28.80");
        expect(money(-1234)).toBe("CNY -12.34");
        expect(money(0)).toBe("CNY 0.00");
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
        await request("user/update", { remind_expire: 1, remind_service: false });
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v10/me");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe(
            "zh-CN",
        );
        expect(fetchMock.mock.calls[0][1].body).toBe('{"expiryReminders":1,"serviceNotifications":false}');
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
        expect(bytes(1073741824)).toBe("1.00 GB");
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
            download("admin/user/dumpCSV", {}, "users.csv"),
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
            "admin/user/dumpCSV",
            { filter: [{ key: "banned", condition: "=", value: 0 }] },
            "users.csv",
        );
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(
            JSON.parse(fetchMock.mock.calls[0][1].body).filter[0].value,
        ).toBe(0);
        expect(create).toHaveBeenCalled();
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).format).toBe("csv");
        expect(link.download).toBe("users.csv");
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
