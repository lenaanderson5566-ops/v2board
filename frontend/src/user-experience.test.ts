import { describe, it, expect, vi, afterEach } from "vitest";
import { deviceContext, activePlan, passwordScore } from "./user-experience";
import { recommendedClients, clientSubscriptionUrl } from "./import-links";
import { createReadCache } from "./read-cache";
describe("device-aware user experience", () => {
    it.each([
        ["Mozilla iPhone Mobile Safari", "ios"],
        ["Mozilla Android Chrome", "android"],
        ["Mozilla Windows NT 10.0", "windows"],
        ["Mozilla Macintosh Safari", "macos"],
        ["Mozilla X11 Linux x86_64", "linux"],
        ["unknown", "unknown"],
    ] as const)(
        "detects %s without relying on a browser name",
        (ua, expected) => expect(deviceContext(ua).device).toBe(expected),
    );
    it("recognizes Windows even when the platform uses Win32", () =>
        expect(
            deviceContext("Mozilla Windows NT 10.0 Chrome", "Win32").device,
        ).toBe("windows"));
    it("recognizes desktop-mode iPads", () =>
        expect(
            deviceContext("Mozilla Macintosh Safari", "MacIntel", 5).device,
        ).toBe("ios"));
    it.each([
        ["MicroMessenger/8", "WeChat"],
        ["Mobile QQ/9.0", "QQ"],
        ["Weibo (iPhone)", "Weibo"],
        ["MQQBrowser/12 Mobile", "none"],
        ["Chrome/140", "none"],
    ])("identifies embedded contexts precisely: %s", (ua, expected) =>
        expect(deviceContext(ua).embedded || "none").toBe(expected),
    );
    it("offers Android-compatible imports without Apple-only clients", () => {
        const ids = recommendedClients("android").map((client) => client.id);
        expect(ids).toContain("cmfa");
        expect(ids).toContain("singbox");
        expect(ids).not.toContain("shadowrocket");
        expect(ids).not.toContain("surge");
    });
    it("keeps a focused default recommendation when the device is unknown", () =>
        expect(recommendedClients("unknown")).toHaveLength(3));
    it("keeps the selected format for manual import and preserves credentials", () => {
        const url = new URL(
            clientSubscriptionUrl(
                "singbox",
                "https://example.test/a?token=a%2Bb",
            ),
        );
        expect(url.searchParams.get("flag")).toBe("sing");
        expect(url.searchParams.get("token")).toBe("a+b");
    });
    it("only marks a real plan within its validity period", () => {
        const now = 100000;
        expect(activePlan({ name: "Pro" }, 101, now)).toBe(true);
        expect(activePlan({ name: "Pro" }, 100, now)).toBe(false);
        expect(activePlan({ name: "Pro" }, null, now)).toBe(true);
        expect(activePlan(null, null, now)).toBe(false);
        expect(activePlan({ name: "Pro" }, undefined, now)).toBe(false);
        expect(activePlan({ name: "Pro" }, 0, now)).toBe(false);
    });
    it("does not mark an empty or short password strong", () => {
        expect(passwordScore("")).toBe(0);
        expect(passwordScore("A1!a")).toBe(1);
        expect(passwordScore("a-long-Unique-phrase!23")).toBe(5);
    });
});
describe("private in-memory request cache", () => {
    afterEach(() => vi.useRealTimers());
    it("shares in-flight requests and separates sessions", async () => {
        const cache = createReadCache(),
            load = vi.fn(async () => ({ email: "a" }));
        const result = await Promise.all([
            cache.read("session-a:info", load),
            cache.read("session-a:info", load),
        ]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(result[0]).toBe(result[1]);
        await cache.read("session-b:info", load);
        expect(load).toHaveBeenCalledTimes(2);
    });
    it("expires stale data and allows an explicit refresh", async () => {
        vi.useFakeTimers();
        const cache = createReadCache(100),
            load = vi.fn(async () => 1);
        await cache.read("key", load);
        await cache.read("key", load);
        expect(load).toHaveBeenCalledTimes(1);
        await cache.read("key", load, true);
        expect(load).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(101);
        await cache.read("key", load);
        expect(load).toHaveBeenCalledTimes(3);
    });
    it("does not cache a response that arrives after a mutation or logout", async () => {
        const cache = createReadCache();
        let finish!: (value: string) => void;
        const first = cache.read(
            "key",
            () =>
                new Promise<string>((resolve) => {
                    finish = resolve;
                }),
        );
        cache.clear();
        finish("stale");
        await first;
        expect(await cache.read("key", async () => "fresh")).toBe("fresh");
    });
    it("retries failures instead of caching them", async () => {
        const cache = createReadCache();
        await expect(
            cache.read("key", async () => {
                throw Error("offline");
            }),
        ).rejects.toThrow("offline");
        expect(await cache.read("key", async () => "recovered")).toBe(
            "recovered",
        );
    });
});
