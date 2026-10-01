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
const { request, rows, query, bytes, storageKey } = await import("./api");
describe("API client", () => {
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
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/user/update");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
            "session-token",
        );
        expect(fetchMock.mock.calls[0][1].headers["Content-Language"]).toBe(
            "zh-CN",
        );
        expect(fetchMock.mock.calls[0][1].body).toBe('{"remind_expire":1}');
    });
    it("clears expired sessions and reports access errors", async () => {
        storage.set(storageKey, "expired");
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response('{"message":"登录已过期"}', { status: 403 }),
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
