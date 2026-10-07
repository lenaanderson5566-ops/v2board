import { beforeEach, expect, it, vi } from "vitest";
const stored = new Map<string, string>();
vi.stubGlobal("window", { V2BOARD: { mode: "user" } });
vi.stubGlobal("document", { documentElement: { lang: "", dir: "" } });
vi.stubGlobal("navigator", { language: "en-US" });
vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
});
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
    window.V2BOARD.mode = "user";
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
        headers: { "X-Browser-Client": "user", "X-CSRF-Token": "csrf" },
    });
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined();
    expect(stored.size).toBe(0);
});
it("exchanges a legacy token once and removes the old localStorage credential", async () => {
    stored.set("v2board.user.auth", "legacy-secret");
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(reply())
        .mockResolvedValueOnce(reply(true, "rotated"));
    vi.stubGlobal("fetch", fetcher);
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    await sessions.initializeBrowserSession();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
        legacyToken: "legacy-secret",
    });
    expect(fetcher.mock.calls[1][1].headers["X-CSRF-Token"]).toBe("csrf");
    expect(stored.size).toBe(0);
    expect(sessions.hasBrowserSession()).toBe(true);
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
    expect(fetcher.mock.calls[3][1].headers["X-CSRF-Token"]).toBe("fresh");
});
it("clears an expired legacy credential and leaves the user signed out", async () => {
    stored.set("v2board.user.auth", "expired-secret");
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValueOnce(reply())
            .mockResolvedValueOnce(reply(false, "csrf", 401)),
    );
    const sessions = await import("./browser-session");
    await sessions.initializeBrowserSession();
    expect(stored.size).toBe(0);
    expect(sessions.hasBrowserSession()).toBe(false);
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
