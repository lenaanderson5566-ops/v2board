// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor, screen, fireEvent, act } from "@testing-library/react";
const vital = vi.hoisted(() => ({ lcp: vi.fn(), inp: vi.fn(), cls: vi.fn() }));
vi.mock("web-vitals", () => ({
    onLCP: vital.lcp,
    onINP: vital.inp,
    onCLS: vital.cls,
}));
vi.mock("../shared/runtime-config", () => ({ apiUrl: (p: string) => p }));
vi.mock("../shared/i18n", () => ({ locale: () => "zh-CN", tx: (key: string) => key, default: { t: (key: string) => key } }));
vi.mock("../shared/api", () => ({ boot: { mode: "user", tosUrl: "" } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
import {
    consent,
    privacyKey,
    privacyChoice,
    privacyRevision,
    savePrivacyChoice,
    setCollection,
    trackAction,
    useAnalyticsPage,
} from "./product-analytics";
import { observeApi } from "../shared/telemetry";
import { AnalyticsPrivacy, AnalyticsPrivacySetting } from "./AnalyticsPrivacy";
import { localPreferences } from "../shared/browser-storage";
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
    localPreferences.removeItem(privacyKey);
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
const legacyPrivacyKey="v2board.analytics.consent.v2.%2Fapi%2Fv10";

it("retains an earlier refusal without granting analytics during the brand migration", async () => {
    localStorage.setItem(legacyPrivacyKey,JSON.stringify({choice:"deny",version:3,chosenAt:Date.now(),retentionDays:30}));
    render(<Page />);setCollection(true);trackAction("download");
    await Promise.resolve();
    expect(consent()).toBe("deny");expect(fetcher).not.toHaveBeenCalled();
    expect(localStorage.getItem(privacyKey)).toBeNull();
});

it("takes the newest valid decision across both namespaces and lets an equal-time refusal win", () => {
    const now=Date.now();
    const choice=(value:"allow"|"deny",chosenAt:number)=>JSON.stringify({choice:value,chosenAt,version:privacyRevision,retentionDays:30});
    localStorage.setItem(privacyKey,choice("allow",now));
    localStorage.setItem(legacyPrivacyKey,choice("deny",now));
    expect(privacyChoice()?.choice).toBe("deny");
    localStorage.setItem(legacyPrivacyKey,choice("allow",now));
    localStorage.setItem(privacyKey,choice("deny",now));
    expect(consent()).toBe("deny");
    localStorage.setItem(privacyKey,choice("allow",now));
    localStorage.setItem(legacyPrivacyKey,choice("deny",now-1));
    expect(consent()).toBe("allow");
});

it("publishes a new withdrawal to older tabs and stops collection when an older tab withdraws", async () => {
    const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now);
    fetcher.mockImplementation(async(url:string)=>url.endsWith("/configuration")
        ? {ok:true,json:async()=>({data:{enabled:true,retentionDays:30}})} : {ok:true});
    savePrivacyChoice("allow",30);
    render(<><Page /><AnalyticsPrivacy /></>);
    const reports=()=>fetcher.mock.calls.filter(([url])=>String(url).endsWith("/events"));
    await waitFor(()=>expect(reports().length).toBeGreaterThan(0));
    const before=reports().length;
    await act(async()=>{
        const denial=JSON.stringify({choice:"deny",version:privacyRevision,chosenAt:now,retentionDays:30});
        localStorage.setItem(legacyPrivacyKey,denial);
        window.dispatchEvent(new StorageEvent("storage",{key:legacyPrivacyKey,newValue:denial,storageArea:localStorage}));
        trackAction("payment_open","payment");
        await Promise.resolve();
    });
    expect(consent()).toBe("deny");expect(reports()).toHaveLength(before);
    expect(savePrivacyChoice("deny",30)).toBe(true);
    expect(JSON.parse(localStorage.getItem(legacyPrivacyKey)!).choice).toBe("deny");
    expect(localStorage.getItem(privacyKey)).toBe(localStorage.getItem(legacyPrivacyKey));
});

it("shows the storage failure and grants no consent when the new preference cannot be persisted", async () => {
    fetcher.mockImplementation(async(url:string)=>url.endsWith("/configuration")
        ? {ok:true,json:async()=>({data:{enabled:true,retentionDays:30}})} : {ok:true});
    render(<><AnalyticsPrivacy /><AnalyticsPrivacySetting /></>);
    const toggle=screen.getByRole("switch");
    await waitFor(()=>expect((toggle as HTMLButtonElement).disabled).toBe(false));
    const native=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key:string,value:string){
        if(key===privacyKey)throw new DOMException("Full","QuotaExceededError");
        native.call(this,key,value);
    });
    fireEvent.click(toggle);
    expect(screen.getByRole("status").textContent).toContain("analyticsStorageError");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(consent()).toBeNull();expect(localStorage.getItem(legacyPrivacyKey)).toBeNull();
});

it("withdraws through an existing legacy key when new-key persistence is full, while reporting the failure", async () => {
    localStorage.setItem(legacyPrivacyKey,JSON.stringify({choice:"allow",version:privacyRevision,chosenAt:Date.now()-100,retentionDays:30}));
    fetcher.mockImplementation(async(url:string)=>url.endsWith("/configuration")
        ? {ok:true,json:async()=>({data:{enabled:true,retentionDays:30}})} : {ok:true});
    render(<><AnalyticsPrivacy /><AnalyticsPrivacySetting /></>);
    const toggle=screen.getByRole("switch");
    await waitFor(()=>expect(toggle.getAttribute("aria-checked")).toBe("true"));
    const native=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key:string,value:string){
        if(key===privacyKey)throw new DOMException("Full","QuotaExceededError");
        native.call(this,key,value);
    });
    fireEvent.click(toggle);
    expect(screen.getByRole("status").textContent).toContain("analyticsStorageError");
    expect(toggle.getAttribute("aria-checked")).toBe("false");expect(consent()).toBe("deny");
    expect(localStorage.getItem(privacyKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(legacyPrivacyKey)!).choice).toBe("deny");
    trackAction("payment_open","payment");await Promise.resolve();
    expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith("/events"))).toHaveLength(0);
});

it("keeps refusal effective in this tab even if neither namespace can be persisted", () => {
    localStorage.setItem(legacyPrivacyKey,JSON.stringify({choice:"allow",version:privacyRevision,chosenAt:Date.now()-100,retentionDays:30}));
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new DOMException("Full","QuotaExceededError");});
    expect(savePrivacyChoice("deny",30)).toBe(false);
    expect(consent()).toBe("deny");
    expect(savePrivacyChoice("allow",30)).toBe(false);
    expect(consent()).toBe("deny");
});
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
    expect(privacyRevision).toBe(5);
});
it("does not report views, guide actions or API observations without permission", async () => {
    render(<Page />);
    setCollection(true);
    trackAction("download");
    trackAction("payment_open", "payment");
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
    trackAction("payment_open", "payment");
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
    trackAction("payment_open", "payment");
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

it("guide actions remain consent gated and do not include the handoff URL or raw UA", async () => {
    trackAction("guide_continue", "browser_prompt");
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    savePrivacyChoice("allow", 30);
    setCollection(true);
    trackAction("guide_manual", "browser_guide");
    await waitFor(() =>
        expect(events().some((e) => e.event === "guide_manual")).toBe(true),
    );
    const event = events().find((e) => e.event === "guide_manual");
    expect(event.page).toBe("browser_guide");
    expect(event).not.toHaveProperty("url");
    expect(event).not.toHaveProperty("userAgent");
    expect(event).not.toHaveProperty("ip");
});

it("records explicit payment entry clicks and copy results without reporting a payment result or private contents", async () => {
    savePrivacyChoice("allow", 30);
    setCollection(true);
    trackAction("payment_open", "payment");
    trackAction("copy_success", "payment");
    trackAction("copy_failed", "payment");
    await waitFor(() => expect(events()).toHaveLength(3));
    expect(events().map((event) => event.event)).toEqual([
        "payment_open",
        "copy_success",
        "copy_failed",
    ]);
    for (const event of events()) {
        expect(event.page).toBe("payment");
        expect(Object.keys(event).sort()).toEqual(
            [
                "attributionVersion",
                "consent",
                "device",
                "event",
                "language",
                "page",
                "sessionId",
            ].sort(),
        );
        expect(event).not.toHaveProperty("value");
        expect(event).not.toHaveProperty("orderNumber");
        expect(event).not.toHaveProperty("url");
    }
});
