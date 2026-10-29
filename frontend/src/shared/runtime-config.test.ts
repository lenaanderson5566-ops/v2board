// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    apiUrl,
    initializeRuntime,
    normalizeApiOrigin,
    startupError,
} from "./runtime-config";
import startupCopy from "./startup-copy.json";

beforeEach(() => {
    delete (window as any).V2BOARD;
    document.body.innerHTML = '<div id="root"></div>';
    localStorage.clear();
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
it("offers safe startup recovery without relying on React or showing internal error details", () => {
    localStorage.setItem("v2board.language", "en-US");
    const retry = vi.fn();
    startupError(new Error("Failed private configuration /internal/path?token=secret"), retry);
    const root = document.getElementById("root")!;
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.textContent).toContain("Check your connection");
    expect(root.textContent).not.toMatch(/internal|secret|configuration/);
    expect(document.activeElement).toBe(root.querySelector("h1"));
    root.querySelector("button")!.click();
    expect(retry).toHaveBeenCalledTimes(1);
});
it("provides independent startup copy for all interface languages and safely falls back for unknown preferences", () => {
    expect(Object.keys(startupCopy)).toHaveLength(14);
    for(const copy of Object.values(startupCopy)) {
        expect(copy).toHaveLength(3);
        expect(copy.every((value)=>typeof value === "string" && value.length > 0)).toBe(true);
    }
    localStorage.setItem("v2board.language", "constructor");
    expect(()=>startupError("ignored")).not.toThrow();
    expect(document.querySelector("#root h1")?.textContent).toBe("This page could not load");
});
it("keeps startup recovery localized and usable when preference storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    Object.defineProperty(window.navigator, "language", { value: "fa-IR", configurable: true });
    try {
        startupError("ignored");
        const panel = document.querySelector("#root section")!;
        expect(panel.getAttribute("dir")).toBe("rtl");
        expect(panel.querySelector("button")?.textContent).toBe("بارگیری دوباره");
    } finally {
        vi.restoreAllMocks();
        Object.defineProperty(window.navigator, "language", { value: "en-US", configurable: true });
    }
});
