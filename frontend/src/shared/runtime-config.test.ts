// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    apiUrl,
    initializeRuntime,
    normalizeApiOrigin,
} from "./runtime-config";

beforeEach(() => {
    delete (window as any).V2BOARD;
    document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => vi.unstubAllGlobals());
it("keeps integrated deployment relative and directs only API paths to a configured backend", () => {
    expect(apiUrl("/api/v10/me", "")).toBe("/api/v10/me");
    expect(apiUrl("/api/v10/me", "https://api.example.com/")).toBe(
        "https://api.example.com/api/v10/me",
    );
    expect(() =>
        apiUrl("//other.example/me", "https://api.example.com"),
    ).toThrow();
    for (const value of [
        "http://remote.example",
        "https://user:pass@example.com",
        "https://api.example.com/path",
        "https://api.example.com?token=x",
    ])
        expect(() => normalizeApiOrigin(value)).toThrow();
});
it("uses existing server configuration without requesting a static configuration file", async () => {
    window.V2BOARD = { mode: "user", title: "FastDog", landing: false } as any;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await initializeRuntime("user");
    expect(fetcher).not.toHaveBeenCalled();
    expect(window.V2BOARD.landing).toBe(false);
});
it("loads standalone user configuration without credentials and strips administrative paths", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValue(
            new Response(
                JSON.stringify({
                    title: "FastDog",
                    apiBaseUrl: "https://api.example.com",
                    adminPath: "private",
                    opsPath: "ops",
                    landing: false,
                }),
            ),
        );
    vi.stubGlobal("fetch", fetcher);
    await initializeRuntime("user");
    expect(fetcher.mock.calls[0][0]).toBe("/user-config.json");
    expect(fetcher.mock.calls[0][1].credentials).toBe("omit");
    expect(window.V2BOARD).toMatchObject({
        mode: "user",
        adminPath: "",
        opsPath: "",
        apiBaseUrl: "https://api.example.com",
    });
});
it("rejects using a user configuration to start the admin entry", async () => {
    window.V2BOARD = { mode: "user" } as any;
    await expect(initializeRuntime("admin")).rejects.toThrow(/do not match/);
});
