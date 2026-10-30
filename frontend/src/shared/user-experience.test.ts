import { describe, it, expect, vi, afterEach } from "vitest";
import { deviceContext, currentDevice, activePlan, passwordScore } from "./user-experience";
import { recommendedClients, clientSubscriptionUrl } from "./import-links";
import { createReadCache } from "./read-cache";
import { browserHandoffUrl, browserPolicy, browserReturnPath } from "./browser-access";
import { purchaseReturnPath } from "../user/checkout-navigation";
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
        expect(url.searchParams.get("format")).toBe("sing-box");
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
describe("bounded embedded-browser presentation", () => {
    it.each(["WeChat", "QQ", "Weibo", "wecom"])("defaults %s to guidance while honoring each explicit policy", embedded => {
        const key = ({ WeChat: "wechat", QQ: "qq", Weibo: "weibo", wecom: "wecom" } as const)[embedded as "WeChat" | "QQ" | "Weibo" | "wecom"];
        expect(browserPolicy(embedded)).toBe("guide");
        expect(browserPolicy(embedded, { [key]: "invalid" as any })).toBe("guide");
        for (const policy of ["allow", "prompt", "guide"] as const)
            expect(browserPolicy(embedded, { [key]: policy })).toBe(policy);
    });
    it("allows an unknown browser when device identity APIs are unavailable", () => {
        vi.stubGlobal("navigator", {});
        try { expect(currentDevice()).toEqual({ device: "unknown", embedded: null }); }
        finally { vi.unstubAllGlobals(); }
    });
    it.each([
        ["MicroMessenger/8 wxwork/4", "wecom"],
        ["DingTalk MicroMessenger wxwork/4", "wecom"],
        ["XiaoHongShu/9 MicroMessenger/8", "xiaohongshu"],
        ["Aweme/30", "douyin"],
        ["BiliApp/8", "bilibili"],
        ["AlipayClient/10", "alipay"],
        ["DingTalk/7", "dingtalk"],
        ["MICROMESSENGER/8", "WeChat"],
        ["Mobile QQ/9.0 MQQBrowser/15.0", "QQ"],
        ["Mozilla Android;wv) Chrome/130", "Other"],
        ["Mozilla Android;  wv; Chrome/130", "Other"],
        ["[FB_IAB/FB4A;]", "Other"],
        ["Instagram 300", "Other"],
        ["MQQBrowser/15.0", null],
        ["NotQQ/9.0", null],
        ["NotInstagram/300", null],
        ["Mozilla iPhone AppleWebKit/605.1 Version/18.0 Mobile Safari/605.1", null],
        ["Mozilla Android Chrome/130 Mobile Safari/537.36", null],
        ["x".repeat(1024) + " MicroMessenger/8", null],
    ])("classifies %s without widening configured restrictions", (ua, embedded) => {
        expect(deviceContext(ua).embedded).toBe(embedded);
        if (embedded === null) expect(browserPolicy(embedded, { other: "guide" })).toBe("allow");
    });
});

describe("safe cross-browser navigation", () => {
    it("preserves purchase choices while removing credentials and payment instructions", () => {
        const address = browserHandoffUrl("https://user:secret@example.test/account?token=secret#/plan/2?period=year_price&couponId=7&replace=unpaid-42&expected_payment_amount=1&payment_request_key=secret&redirect=https://other.test");
        expect(address).toBe("https://example.test/account#/plan/2?period=year_price&couponId=7&replace=unpaid-42");
        expect(purchaseReturnPath(new URL(address).hash)).toBe("plan/2?period=year_price&couponId=7&replace=unpaid-42");
        expect(browserReturnPath(address)).toBe("plan/2?period=year_price&couponId=7&replace=unpaid-42");
    });
    it("keeps a selected catalog plan and period for revalidation after sign-in", () => {
        expect(browserHandoffUrl("https://example.test/#/plan?selected=3&period=half_year_price&couponId=4&access_token=secret"))
            .toBe("https://example.test/#/plan?period=half_year_price&selected=3&couponId=4");
    });
    it("resumes an existing order without merging new coupon or replacement instructions", () => {
        expect(browserHandoffUrl("https://example.test/#/plan/2?order=owned-order_1&period=month_price&couponId=7&replace=another&payment=secret"))
            .toBe("https://example.test/#/plan/2?order=owned-order_1");
    });
    it.each(["/knowledge", "/order/owned-order_1", "/ticket/order/owned-order_1", "/subscribe", "/traffic"])("keeps the existing safe navigation target %s", path => {
        expect(browserHandoffUrl(`https://example.test/account#${path}?token=secret&authorizationId=secret`))
            .toBe(`https://example.test/account#${path}`);
        expect(browserReturnPath(`https://example.test/account#${path}?token=secret&authorizationId=secret`)).toBe(path.slice(1));
    });
    it("drops ambiguous and invalid selection parameters", () => {
        expect(browserHandoffUrl("https://example.test/#/plan?selected=1&selected=2&period=year_price&period=month_price&couponId=0"))
            .toBe("https://example.test/#/plan");
        expect(browserHandoffUrl("https://example.test/#/plan/2?order=a&order=b&replace=a&replace=b&period=onetime_price&couponId=9007199254740992"))
            .toBe("https://example.test/#/plan/2");
        expect(purchaseReturnPath("#/plan/2?period=year_price&replace=a&replace=b")).toBe("plan/2?period=year_price");
    });
    it.each(["/plan/9007199254740992", "/plan/0", "/plan/01", "/client-authorize", "/order/a%2Fb", "/ticket/order/a%2Fb"])("does not carry authorization or invalid references from %s", path => {
        expect(browserHandoffUrl(`https://example.test/#${path}?authorizationId=secret&verify=secret&code=legacy`))
            .toBe("https://example.test/#/login");
    });
    it("preserves only one validated registration invitation pair", () => {
        const invitation="a".repeat(64);
        expect(browserHandoffUrl(`https://example.test/#/register?invitation=${invitation}&email=member%40example.test&verify=secret`))
            .toBe(`https://example.test/#/register?invitation=${invitation}&email=member%40example.test`);
        expect(browserHandoffUrl(`https://example.test/#/register?invitation=${invitation}&invitation=${invitation}&email=member%40example.test`))
            .toBe("https://example.test/#/register");
        expect(browserHandoffUrl(`https://example.test/#/login?invitation=${invitation}&email=member%40example.test`))
            .toBe("https://example.test/#/login");
    });
    it("retains the legacy navigation code without transferring login verification", () => {
        expect(browserHandoffUrl("https://example.test/account?token=secret#/login?verify=secret&code=legacy"))
            .toBe("https://example.test/account#/login?code=legacy");
        expect(browserHandoffUrl("https://example.test/account?code=legacy&token=secret"))
            .toBe("https://example.test/account?code=legacy");
        expect(browserHandoffUrl("https://example.test/#/login?code=a&code=b&verify=secret"))
            .toBe("https://example.test/#/login");
    });
    it.each(["javascript:alert(1)", "data:text/html,test", "file:///local/test", "not a URL"])("rejects an unusable handoff target: %s", value => {
        expect(browserHandoffUrl(value)).toBe("");
        expect(browserReturnPath(value)).toBeUndefined();
    });
    it.each(["", "#/", "#/login?verify=secret", "#/register?email=member%40example.test", "#/forget", "#/client-authorize?authorizationId=secret", "#/admin?token=secret", "#/plan/9007199254740992"])("does not turn an auth, rejected or empty route into a login return target: %s", hash => {
        expect(browserReturnPath(`https://example.test/account${hash}`)).toBeUndefined();
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
