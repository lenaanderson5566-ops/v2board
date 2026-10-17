// @vitest-environment jsdom
vi.mock("../shared/i18n", () => ({ locale: () => "zh-CN" }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    boot: {
        title: "Example AI",
        landingStyle: "original",
        registerClosed: false,
        inviteRequired: false,
        tosUrl: "https://example.com/terms",
    },
}));
vi.mock("../shared/api", () => mocks);
vi.mock("../shared/BannerStrip", () => ({ BannerStrip: () => null }));
vi.mock("./landing-copy", () => ({}));
vi.mock("../shared/LanguagePicker", () => ({
    LanguagePicker: () => <span>Language</span>,
}));
vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../shared/user-experience", () => ({
    currentDevice: () => ({ device: "android", embedded: null }),
}));
import Landing from "./Landing";
afterEach(() => {
    cleanup();
    mocks.boot.registerClosed = false;
    mocks.boot.inviteRequired = false;
    mocks.boot.landingStyle = "original";
});
it("selects the minimal landing and keeps a keyboard-accessible auth entry", () => {
    mocks.boot.landingStyle = "minimal";
    render(<Landing />);
    expect(screen.getByRole("heading", { name: "aiTitle" })).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
    expect(screen.getByText("aiNote")).toBeTruthy();
    expect(screen.getByRole("link", { name: "scrollToAuth" }).getAttribute("href")).toBe("/app#/login");
    expect(screen.getByRole("link", { name: "signIn" }).getAttribute("href")).toBe("/app#/login");
});
it("falls back to the original landing for unknown settings", () => {
    mocks.boot.landingStyle = "unknown";
    render(<Landing />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
});
it("enters auth only after scrolling and removes its listener on unmount", () => {
    mocks.boot.landingStyle = "minimal";
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<Landing />);
    const listener = add.mock.calls.find(([name]) => name === "scroll")?.[1] as () => void;
    const assign = vi.fn();
    const fakeWindow = { scrollY: 0, location: { assign } };
    try {
        vi.stubGlobal("window", fakeWindow);
        listener();
        expect(assign).not.toHaveBeenCalled();
        fakeWindow.scrollY = 80;
        listener();
        listener();
        expect(assign).toHaveBeenCalledExactlyOnceWith("/app#/login");
    } finally {
        vi.unstubAllGlobals();
        view.unmount();
    }
    expect(remove).toHaveBeenCalledWith("scroll", listener);
    add.mockRestore();
    remove.mockRestore();
});
describe("public product entry", () => {
    it("uses the configured brand and shows AI service brands before setup", () => {
        render(<Landing />);
        expect(
            screen.getAllByRole("link", { name: "Example AI" })[0],
        ).toHaveProperty("href", expect.stringContaining("/"));
        expect(screen.queryByRole("button", { name: "Android" })).toBeNull();
        expect(screen.getByText("aiTitle")).toBeTruthy();
        expect(screen.getByText("OpenAI")).toBeTruthy();
        expect(screen.getByText("Claude")).toBeTruthy();
        expect(screen.getByText("Gemini")).toBeTruthy();
        expect(screen.getByText("aiNote")).toBeTruthy();
        expect(
            screen
                .getAllByRole("link", { name: "start" })
                .every(
                    (link) => link.getAttribute("href") === "/app#/register",
                ),
        ).toBe(true);
    });
    it("respects registration closure and provides help before direct support", () => {
        mocks.boot.registerClosed = true;
        render(<Landing />);
        expect(
            screen
                .getAllByRole("link", { name: "start" })
                .every((link) => link.getAttribute("href") === "/app#/login"),
        ).toBe(true);
        expect(document.querySelector('a[href="/app#/ticket"]')).toBeNull();
        expect(
            screen.getByRole("link", { name: "terms" }).getAttribute("href"),
        ).toBe(mocks.boot.tosUrl);
    });
    it("closes mobile navigation with Escape and restores focus", () => {
        render(<Landing />);
        const trigger = screen.getByRole("button", { name: "examples" });
        fireEvent.click(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        fireEvent.keyDown(window, { key: "Escape" });
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
    });
});

it("labels invitation-only entry clearly", () => {
    mocks.boot.inviteRequired = true;
    render(<Landing />);
    expect(
        screen
            .getAllByRole("link", { name: "inviteStart" })
            .every((el) => el.getAttribute("href") === "/app#/register"),
    ).toBe(true);
});
