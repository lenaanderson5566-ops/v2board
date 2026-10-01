import { describe, it, expect } from "vitest";
import { clients, importLink, subscriptionUrl } from "./import-links";
const url = "https://example.com/subscribe?token=a%2Bb%26c&flag=old";
describe("subscription import protocols", () => {
    it("preserves access tokens while replacing the client format", () => {
        const link = new URL(importLink("clash", url, "测试 & Home"));
        const nested = new URL(link.searchParams.get("url")!);
        expect(nested.searchParams.get("token")).toBe("a+b&c");
        expect(nested.searchParams.getAll("flag")).toEqual(["meta"]);
        expect(link.searchParams.get("name")).toBe("测试 & Home");
    });
    it("generates all supported schemes without third-party converters", () => {
        for (const client of clients) {
            const link = importLink(client.id, url, "My plan");
            expect(link).not.toMatch(/^https?:/);
            expect(link).not.toContain("undefined");
        }
        expect(importLink("hiddify", url, "My plan")).toContain(
            "hiddify://import/https://example.com/subscribe?",
        );
        const sing = new URL(importLink("singbox", url, "My plan"));
        expect(
            new URL(sing.searchParams.get("url")!).searchParams.get("flag"),
        ).toBe("sing");
        const qx = new URL(importLink("quantumult", url, "My,plan"));
        const config = JSON.parse(qx.searchParams.get("remote-resource")!);
        expect(config.server_remote[0]).toContain("tag=My plan");
        expect(config.server_remote[0]).toContain("flag=quantumult%2520x");
    });
    it("encodes Shadowrocket links as URL-safe UTF-8 base64", () => {
        const link = importLink(
            "shadowrocket",
            "https://example.com/订阅?token=abc",
            "测试",
        );
        const payload = link.split("sub://")[1].split("?")[0];
        expect(payload).not.toMatch(/[+/=]/);
        const decoded = new TextDecoder().decode(
            Uint8Array.from(
                atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
                (c) => c.charCodeAt(0),
            ),
        );
        expect(new URL(decoded).searchParams.get("flag")).toBe("shadowrocket");
    });
    it("rejects unsafe or malformed subscription URLs", () => {
        for (const invalid of [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:pass@example.com/a",
            "not-a-url",
        ])
            expect(() => subscriptionUrl(invalid)).toThrow();
    });
});
