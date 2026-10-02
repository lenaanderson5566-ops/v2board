// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    boot: {
        title: "Example AI",
        registerClosed: false,
        tosUrl: "https://example.com/terms",
    },
}));
vi.mock("./api", () => mocks);
vi.mock("./landing-copy", () => ({}));
vi.mock("./LanguagePicker", () => ({
    LanguagePicker: () => <span>Language</span>,
}));
vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./user-experience", () => ({
    currentDevice: () => ({ device: "android", embedded: null }),
}));
import Landing from "./Landing";
afterEach(() => {
    cleanup();
    mocks.boot.registerClosed = false;
});
describe("public product entry", () => {
    it("uses the configured brand and explains use cases before setup", () => {
        render(<Landing />);
        expect(
            screen.getAllByRole("link", { name: "Example AI" })[0],
        ).toHaveProperty("href", expect.stringContaining("/"));
        expect(screen.queryByRole("button", { name: "Android" })).toBeNull();
        expect(screen.getByText("scenarioTitle")).toBeTruthy();
        expect(screen.getByText("scenario1")).toBeTruthy();
        expect(screen.getByText("scenario2")).toBeTruthy();
        expect(screen.getByText("scenario3")).toBeTruthy();
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
