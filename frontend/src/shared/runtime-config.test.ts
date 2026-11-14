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
    delete (window as any).FASTAI;
    delete window.V2BOARD;
    document.body.innerHTML = '<div id="root"></div>';
    localStorage.clear();
});

it("accepts a previous bootstrap input and normalizes only exact default names", async () => {
    window.V2BOARD={mode:"user",title:"V2Board",landing:false} as any;
    vi.stubGlobal("fetch",vi.fn());
    await initializeRuntime("user");
    expect(window.FASTAI.title).toBe("FastAI");
    expect(window.FASTAI.landing).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    window.FASTAI={mode:"user",title:"My V2Board service"} as any;
    await initializeRuntime("user");
    expect(window.FASTAI.title).toBe("My V2Board service");
});

it.each(["FASTAI", "V2BOARD"] as const)("keeps custom runtime settings and the final shared alias from %s input", async (name) => {
    const supplied = {
        mode: "user", title: "My V2Board service", description: "Custom description",
        footerHtml: '<a href="https://site.example/help">Custom footer</a>',
        apiBaseUrl: "https://api.example.com/", tosUrl: "https://site.example/terms",
        adminPath: "custom-admin", opsPath: "custom-ops", landing: false, landingStyle: "minimal",
        emailVerify: true, registerClosed: true, passkeyEnabled: true, inviteRequired: false,
        appleAccountEnabled: false, clientMirrors: { clash_windows: "https://downloads.example/client" },
        clientPolicies: { mihomo: { enabled: false, minVersion: "1.2.3" } },
        customTheme: { color: "#123456", enabled: false, items: [] },
    };
    window[name] = supplied as any;
    await initializeRuntime("user");
    expect(window.V2BOARD).toBe(window.FASTAI);
    expect(window.FASTAI).toMatchObject({ ...supplied, apiBaseUrl: "https://api.example.com", adminPath: "", opsPath: "" });
    expect(window.FASTAI.clientPolicies).toBe(supplied.clientPolicies);
    expect((window.FASTAI as any).customTheme).toBe(supplied.customTheme);
    expect(document.title).toBe(supplied.title);
});

it("shares normalized custom administrative paths through both bootstrap names", async () => {
    window.FASTAI = { mode: "admin", title: "Custom administration", adminPath: "custom-admin", opsPath: "custom-ops" } as any;
    document.documentElement.lang = "zh-CN";
    document.documentElement.dir = "rtl";
    await initializeRuntime("admin");
    expect(window.V2BOARD).toBe(window.FASTAI);
    expect(window.V2BOARD).toMatchObject({ title: "Custom administration", adminPath: "custom-admin", opsPath: "custom-ops" });
    expect(document.title).toBe("Workspace access");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dir).toBe("ltr");
});

it.each(["", "v2boad", " V2BOARD "])("uses the FastAI default for %j", async (title) => {
    window.FASTAI={mode:"user",title} as any;
    await initializeRuntime("user");
    expect(window.FASTAI.title).toBe("FastAI");
});

it("preserves the old language preference during startup recovery", () => {
    localStorage.setItem("v2board.language","fa-IR");
    startupError("ignored");
    expect(document.querySelector("#root section")?.getAttribute("dir")).toBe("rtl");
    expect(localStorage.getItem("fastai.language")).toBeNull();
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
    window.FASTAI = { mode: "user", title: "FastDog", landing: false } as any;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await initializeRuntime("user");
    expect(fetcher).not.toHaveBeenCalled();
    expect(window.FASTAI.landing).toBe(false);
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
    expect(window.FASTAI).toMatchObject({
        mode: "user",
        adminPath: "",
        opsPath: "",
        apiBaseUrl: "https://api.example.com",
    });
});
it("rejects using a user configuration to start the admin entry", async () => {
    window.FASTAI = { mode: "user" } as any;
    await expect(initializeRuntime("admin")).rejects.toThrow(/do not match/);
});
it("offers safe startup recovery without relying on React or showing internal error details", () => {
    localStorage.setItem("fastai.language", "en-US");
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
it("keeps startup recovery in English for the workspace access entry even without boot configuration", () => {
    localStorage.setItem("fastai.language", "zh-CN");
    const retry = vi.fn();
    startupError(new Error("管理员配置不存在"), retry, "admin");
    const root = document.getElementById("root")!;
    expect(document.title).toBe("Workspace access");
    expect(root.querySelector("section")?.getAttribute("lang")).toBe("en-US");
    expect(root.querySelector("h1")?.textContent).toBe("This page could not load");
    expect(root.textContent).not.toContain("管理员配置不存在");
    root.querySelector("button")!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(localStorage.getItem("fastai.language")).toBe("zh-CN");
});
it("provides independent startup copy for all interface languages and safely falls back for unknown preferences", () => {
    expect(Object.keys(startupCopy)).toHaveLength(14);
    for(const copy of Object.values(startupCopy)) {
        expect(copy).toHaveLength(3);
        expect(copy.every((value)=>typeof value === "string" && value.length > 0)).toBe(true);
    }
    localStorage.setItem("fastai.language", "constructor");
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
