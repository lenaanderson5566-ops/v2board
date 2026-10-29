// @vitest-environment jsdom
vi.mock("../shared/i18n", () => ({
    locale: () => "zh-CN",
    tx: (key: string) => key,
}));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
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
    expect(
        screen.getByRole("link", { name: "start" }).getAttribute("href"),
    ).toBe("/app#/register");
    expect(
        screen.getByRole("link", { name: "signIn" }).getAttribute("href"),
    ).toBe("/app#/login");
});
it("falls back to the original landing for unknown settings", () => {
    mocks.boot.landingStyle = "unknown";
    render(<Landing />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
});
it("does not attach scroll navigation to the minimal landing", () => {
    mocks.boot.landingStyle = "minimal";
    const add = vi.spyOn(window, "addEventListener");
    render(<Landing />);
    expect(add.mock.calls.some(([name]) => name === "scroll")).toBe(false);
    expect(document.querySelector(".minimal-landing-scroll-space")).toBeNull();
    add.mockRestore();
});
it.each([true, false])("minimal landing respects registration closure (%s)", (closed) => {
    mocks.boot.landingStyle = "minimal";
    mocks.boot.registerClosed = closed;
    render(<Landing />);
    expect(screen.getByRole("link", { name: closed ? "signIn" : "start" }).getAttribute("href"))
        .toBe(closed ? "/app#/login" : "/app#/register");
    if (closed) expect(document.querySelector('a[href="/app#/register"]')).toBeNull();
});
it("minimal landing labels invitation-only registration", () => {
    mocks.boot.landingStyle = "minimal";
    mocks.boot.inviteRequired = true;
    render(<Landing />);
    expect(screen.getByRole("link", { name: "inviteStart" }).getAttribute("href")).toBe("/app#/register");
    expect(screen.getByRole("link", { name: "signIn" })).toBeTruthy();
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
                .getAllByRole("link", { name: "signIn" })
                .every((link) => link.getAttribute("href") === "/app#/login"),
        ).toBe(true);
        expect(screen.queryByRole("link", { name: "start" })).toBeNull();
        expect(document.querySelector('a[href="/app#/register"]')).toBeNull();
        expect(document.querySelector('a[href="/app#/ticket"]')).toBeNull();
        expect(
            screen.getByRole("link", { name: "服务条款" }).getAttribute("href"),
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

it.each(["original", "minimal"])(
    "provides a skip link to focusable main content on the %s landing",
    (style) => {
        mocks.boot.landingStyle = style;
        render(<Landing />);
        expect(screen.getByRole("link", { name: "skip" }).getAttribute("href"))
            .toBe("#landing-content");
        expect(screen.getByRole("main").id).toBe("landing-content");
        expect(screen.getByRole("main").tabIndex).toBe(-1);
    },
);

it.each(["original", "minimal"])(
    "removes the statistics preference entry from the %s landing footer",
    (style) => {
        mocks.boot.landingStyle = style;
        render(<Landing />);
        expect(screen.queryByRole("button", {name:"analyticsPrivacy"})).toBeNull();
    },
);
