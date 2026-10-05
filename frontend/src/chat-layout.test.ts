// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { installChatLayout } from "./chat-layout";
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
    expect(conversation.hasAttribute("data-chat-launcher")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--chat-navigation-offset")).toBe("106px");
    stop(); expect(launcher.hasAttribute("data-chat-launcher")).toBe(false);
    document.body.innerHTML = ""; vi.unstubAllGlobals();
});
