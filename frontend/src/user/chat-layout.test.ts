// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installChatLayout } from "./chat-layout";
afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--chat-navigation-offset");
    vi.unstubAllGlobals();
});

function paymentFixture(position = "sticky", nav = true) {
    document.body.innerHTML = `${nav ? '<nav class="bottom-nav"></nav>' : ''}<div class="purchase-footer" style="position:${position};bottom:80px"></div><div class="crisp-client"><div id="launcher" style="position:fixed;bottom:20px !important"></div><div id="conversation" style="position:fixed"></div></div>`;
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const launcher = document.getElementById("launcher")!;
    const bar = document.querySelector<HTMLElement>(".purchase-footer")!;
    const conversation = document.getElementById("conversation")!;
    let barTop = 580, barHeight = 140;
    bar.getBoundingClientRect = () => ({ width: 390, height: barHeight, top: barTop, bottom: barTop + barHeight, left: 0, right: 390 }) as DOMRect;
    if (nav) document.querySelector("nav")!.getBoundingClientRect = () => ({ height: 68 }) as DOMRect;
    launcher.getBoundingClientRect = () => {
        const bottom = window.innerHeight - Number.parseFloat(launcher.style.bottom);
        return { width: 60, height: 60, top: bottom - 60, bottom } as DOMRect;
    };
    conversation.getBoundingClientRect = () => ({ width: 390, height: 700, bottom: 800 }) as DOMRect;
    let pending: FrameRequestCallback | undefined;
    const frames = vi.fn((callback: FrameRequestCallback) => { pending = callback; return 1; });
    vi.stubGlobal("requestAnimationFrame", frames);
    vi.stubGlobal("cancelAnimationFrame", () => { pending = undefined; });
    let resize = () => {};
    const observed = new Set<Element>();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: () => void) { resize = callback; }
        observe(element: Element) { observed.add(element); }
        unobserve(element: Element) { observed.delete(element); }
        disconnect = disconnect;
    });
    const flush = () => { const callback = pending; pending = undefined; callback?.(0); };
    const stop = installChatLayout();
    flush();
    return { launcher, bar, conversation, frames, flush, stop, observed, disconnect,
        resize: () => resize(), setBar: (top: number, height = 140) => { barTop = top; barHeight = height; } };
}

it.each(["fixed", "sticky"])("keeps the launcher above a visible %s payment bar and follows scroll and size changes", (position) => {
    const view = paymentFixture(position);
    try {
        expect(view.launcher.style.bottom).toBe("236px");
        expect(view.conversation.style.bottom).toBe("");
        expect(view.observed.has(view.bar)).toBe(true);
        view.setBar(520, 200);
        view.resize(); view.flush();
        expect(view.launcher.style.bottom).toBe("296px");
        view.setBar(900);
        document.dispatchEvent(new Event("scroll")); view.flush();
        expect(view.launcher.style.bottom).toBe("84px");
        view.bar.remove();
        window.dispatchEvent(new Event("resize")); view.flush();
        expect(view.observed.has(view.bar)).toBe(false);
    } finally { view.stop(); }
    expect(view.launcher.style.bottom).toBe("20px");
    expect(view.launcher.style.getPropertyPriority("bottom")).toBe("important");
    expect(view.launcher.hasAttribute("data-chat-launcher")).toBe(false);
    expect(view.disconnect).toHaveBeenCalledOnce();
    const frames = view.frames.mock.calls.length;
    document.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(view.frames).toHaveBeenCalledTimes(frames);
});

it("does not treat a static or hidden payment section as a floating toolbar", () => {
    const view = paymentFixture("static");
    try {
        expect(view.launcher.style.bottom).toBe("84px");
        view.bar.style.position = "fixed";
        view.bar.style.visibility = "hidden";
        window.dispatchEvent(new Event("resize")); view.flush();
        expect(view.launcher.style.bottom).toBe("84px");
    } finally { view.stop(); }
});

it("supports a standalone checkout without navigation and restores the launcher when leaving payment", () => {
    const view = paymentFixture("fixed", false);
    try {
        view.bar.className = "checkout-confirm";
        window.dispatchEvent(new Event("resize")); view.flush();
        expect(view.launcher.style.bottom).toBe("236px");
        view.bar.remove();
        window.dispatchEvent(new Event("resize")); view.flush();
        expect(view.launcher.style.bottom).toBe("20px");
        expect(view.launcher.hasAttribute("data-chat-launcher")).toBe(false);
    } finally { view.stop(); }
});

it("returns to navigation clearance when a sticky payment bar scrolls above its bottom docking position", () => {
    const view = paymentFixture();
    try {
        expect(view.launcher.style.bottom).toBe("236px");
        view.setBar(150, 140);
        document.dispatchEvent(new Event("scroll")); view.flush();
        expect(view.launcher.style.bottom).toBe("84px");
        view.setBar(580, 140);
        document.dispatchEvent(new Event("scroll")); view.flush();
        expect(view.launcher.style.bottom).toBe("236px");
    } finally { view.stop(); }
});

it("clamps a tall payment bar on a short screen without oscillating or moving the conversation", async () => {
    const view = paymentFixture();
    try {
        vi.stubGlobal("innerHeight", 360);
        view.setBar(10, 300);
        window.dispatchEvent(new Event("resize")); view.flush();
        expect(view.launcher.style.bottom).toBe("284px");
        expect(view.launcher.getBoundingClientRect().top).toBe(16);
        await Promise.resolve(); view.flush();
        const frames = view.frames.mock.calls.length;
        await Promise.resolve(); view.flush();
        expect(view.frames).toHaveBeenCalledTimes(frames);
        expect(view.launcher.style.bottom).toBe("284px");
        expect(view.conversation.style.bottom).toBe("");
        vi.stubGlobal("matchMedia", () => ({ matches: false }));
        window.dispatchEvent(new Event("resize")); view.flush();
        expect(view.launcher.style.bottom).toBe("20px");
    } finally { view.stop(); }
});

it("raises a late-loading launcher above the nav without moving the conversation", () => {
    document.body.innerHTML = '<nav class="bottom-nav"></nav><div class="crisp-client"><div id="launcher" style="position:fixed"></div><div id="conversation" style="position:fixed"></div></div>';
    const nav = document.querySelector("nav")!;
    const launcher = document.getElementById("launcher")!;
    const conversation = document.getElementById("conversation")!;
    nav.getBoundingClientRect = () => ({height: 90}) as DOMRect;
    launcher.getBoundingClientRect = () => ({width: 60, height: 60, bottom: 700}) as DOMRect;
    conversation.getBoundingClientRect = () => ({width: 390, height: 700, bottom: 700}) as DOMRect;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    let callback: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { callback = fn; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const stop = installChatLayout(); callback(0);
    expect(launcher.hasAttribute("data-chat-launcher")).toBe(true);
    expect(launcher.style.getPropertyValue("bottom")).toBe("106px");
    expect(launcher.style.getPropertyPriority("bottom")).toBe("important");
    expect(conversation.hasAttribute("data-chat-launcher")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--chat-navigation-offset")).toBe("106px");
    stop(); expect(launcher.hasAttribute("data-chat-launcher")).toBe(false);
    expect(launcher.style.getPropertyValue("bottom")).toBe("");
    document.body.innerHTML = ""; vi.unstubAllGlobals();
});
