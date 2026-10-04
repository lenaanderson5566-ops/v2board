import { beforeEach, describe, it, expect, vi } from "vitest";

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
const { request, rows, query, bytes, storageKey, download, logoutSession } =
    await import("./api");
describe("API client", () => {
    it("revokes the current server session before clearing the browser token", async () => {
        storage.set(storageKey, "session-token");
        const fetchMock = vi
            .fn()
            .mockResolvedValue(new Response('{"data":true}', { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await logoutSession();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v10/me/session");
        expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
            "Bearer session-token",
        );
        expect(storage.has(storageKey)).toBe(false);
    });
    it("allows local logout when offline", async () => {
        storage.set(storageKey, "session-token");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("offline")));
        await logoutSession();
        expect(storage.has(storageKey)).toBe(false);
    });
    beforeEach(() => {
        storage.clear();
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
        await request("user/update", { remind_expire: 1 });
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v10/me");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
            "Bearer session-token",
        );
        expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe(
            "zh-CN",
        );
        expect(fetchMock.mock.calls[0][1].body).toBe('{"expiryReminders":1}');
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
        expect(storage.has(storageKey)).toBe(false);
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
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
            "csv-session",
        );
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
    expect(options.headers.Authorization).toBe("upload-session");
});

it("keeps the session on ordinary permission denial", async () => {
    storage.set(storageKey, "valid");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"message":"Forbidden"}', {status:403})));
    await expect(request("user/info")).rejects.toMatchObject({status:403});
    expect(storage.get(storageKey)).toBe("valid");
});
it("times out stalled requests", async () => {
    vi.useFakeTimers();
    try {
        vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })));
        const assertion = expect(request("user/info", undefined, {timeoutMs:100})).rejects.toThrow("请求超时");
        await vi.advanceTimersByTimeAsync(100);
        await assertion;
    } finally { vi.useRealTimers(); }
});
