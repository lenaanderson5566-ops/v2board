// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
const vital = vi.hoisted(() => ({ lcp: vi.fn(), inp: vi.fn(), cls: vi.fn() }));
vi.mock("web-vitals", () => ({
    onLCP: vital.lcp,
    onINP: vital.inp,
    onCLS: vital.cls,
}));
vi.mock("../shared/runtime-config", () => ({ apiUrl: (p: string) => p }));
vi.mock("../shared/i18n", () => ({ locale: () => "zh-CN" }));
import {
    consent,
    privacyKey,
    privacyRevision,
    savePrivacyChoice,
    setCollection,
    trackAction,
    useAnalyticsPage,
} from "./product-analytics";
import { observeApi } from "../shared/telemetry";
const fetcher = vi.fn();
function Page() {
    useAnalyticsPage("subscribe");
    return <div>连接与下载</div>;
}
beforeEach(() => {
    Object.defineProperty(navigator, "doNotTrack", {
        configurable: true,
        get: () => "0",
    });
    localStorage.clear();
    sessionStorage.clear();
    fetcher.mockReset();
    fetcher.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    setCollection(false);
});
afterEach(() => {
    setCollection(false);
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
const events = () =>
    fetcher.mock.calls.map(([, options]) => JSON.parse(options.body));
it("requires renewed permission for previous allows while preserving prior refusals", () => {
    localStorage.setItem(
        privacyKey,
        JSON.stringify({
            choice: "allow",
            version: 3,
            chosenAt: Date.now(),
            retentionDays: 30,
        }),
    );
    expect(consent()).toBe(null);
    localStorage.setItem(
        privacyKey,
        JSON.stringify({
            choice: "deny",
            version: 3,
            chosenAt: Date.now(),
            retentionDays: 30,
        }),
    );
    expect(consent()).toBe("deny");
    expect(privacyRevision).toBe(4);
});
it("does not report views, guide actions or API observations without permission", async () => {
    render(<Page />);
    setCollection(true);
    trackAction("download");
    observeApi({ duration: 100, failure: "api_error" });
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
});
it("sends only named actions and numeric document samples, never link or error contents", async () => {
    savePrivacyChoice("allow", 30);
    render(<Page />);
    setCollection(true);
    trackAction("copy_success");
    trackAction("import_start");
    trackAction("help_open");
    await waitFor(() => expect(vital.lcp).toHaveBeenCalled());
    const report = vital.lcp.mock.calls[0][0];
    report({ value: 1234, entries: [{ url: "private-subscription-token" }] });
    report({ value: 2000 });
    await waitFor(() =>
        expect(events().some((e) => e.event === "lcp")).toBe(true),
    );
    expect(events().filter((e) => e.event === "lcp")).toHaveLength(1);
    expect(events().find((e) => e.event === "lcp").value).toBe(1234);
    expect(events().some((e) => e.event === "copy_success")).toBe(true);
    expect(JSON.stringify(events())).not.toContain(
        "private-subscription-token",
    );
    expect(
        fetcher.mock.calls.every(
            ([, o]) =>
                o.credentials === "omit" && o.referrerPolicy === "no-referrer",
        ),
    ).toBe(true);
});
it("revocation prevents further action and error reporting", async () => {
    savePrivacyChoice("allow", 30);
    render(<Page />);
    setCollection(true);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    savePrivacyChoice("deny", 30);
    setCollection(false);
    const before = fetcher.mock.calls.length;
    trackAction("download");
    observeApi({ duration: 20, failure: "network_error" });
    window.dispatchEvent(new ErrorEvent("error", { message: "secret-stack" }));
    await Promise.resolve();
    expect(fetcher.mock.calls.length).toBe(before);
});
it("honors DNT even after allowing analytics", async () => {
    savePrivacyChoice("allow", 30);
    vi.spyOn(navigator, "doNotTrack", "get").mockReturnValue("1");
    render(<Page />);
    setCollection(true);
    trackAction("download");
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
});
it("bounds API sampling and reports only error categories", async () => {
    savePrivacyChoice("allow", 30);
    render(<Page />);
    setCollection(true);
    for (let i = 0; i < 25; i++)
        observeApi({ duration: 100, failure: i === 0 ? "api_error" : null });
    await waitFor(() =>
        expect(events().filter((e) => e.event === "api_request")).toHaveLength(
            20,
        ),
    );
    expect(events().filter((e) => e.event === "api_error")).toHaveLength(1);
    expect(events().every((e) => !("url" in e) && !("message" in e))).toBe(
        true,
    );
});
