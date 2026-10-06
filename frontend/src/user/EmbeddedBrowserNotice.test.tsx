// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ embedded: "WeChat" as string | null, copy: vi.fn() }));
vi.mock("../shared/user-experience", () => ({ currentDevice: () => ({ embedded: mocks.embedded, device: "ios" }) }));
vi.mock("../shared/api", () => ({ boot: { title: "Example AI" } }));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string, values?: { app: string }) => values ? `${key} ${values.app}` : key }));
import { EmbeddedBrowserNotice } from "./EmbeddedBrowserNotice";
beforeEach(() => {
    mocks.embedded = "WeChat";
    mocks.copy.mockReset();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
});
afterEach(cleanup);
describe("in-app browser guidance", () => {
    it("does not block a regular browser", () => {
        mocks.embedded = null;
        const view = render(<EmbeddedBrowserNotice />);
        expect(view.container.textContent).toBe("");
    });
    it.each([["WeChat", "wechat"], ["QQ", "qq"], ["Weibo", "weibo"]])("names %s and shows two clear steps", (app, label) => {
        mocks.embedded = app;
        render(<EmbeddedBrowserNotice />);
        expect(screen.getByText(`browserHelp ${label}`)).toBeTruthy();
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
        expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("copies the current deep link and confirms the next step", async () => {
        mocks.copy.mockResolvedValue(undefined);
        render(<EmbeddedBrowserNotice />);
        fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
        await waitFor(() => expect(screen.getByRole("status").textContent).toBe("browserCopied"));
        expect(mocks.copy).toHaveBeenCalledWith(location.href);
        expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("reveals a selectable address when clipboard access is denied", async () => {
        mocks.copy.mockRejectedValue(Error("denied"));
        render(<EmbeddedBrowserNotice />);
        fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
        const address = await screen.findByRole("textbox", { name: "copyAddress" });
        expect((address as HTMLInputElement).value).toBe(location.href);
        expect(screen.getByRole("status").textContent).toBe("browserCopyHelp");
        mocks.copy.mockResolvedValue(undefined);
        fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
        await waitFor(() => expect(screen.getByRole("status").textContent).toBe("browserCopied"));
    });
    it("allows manual copying without requiring clipboard permission", () => {
        render(<EmbeddedBrowserNotice />);
        fireEvent.click(screen.getByRole("button", { name: "browserManual" }));
        expect(screen.getByRole("textbox", { name: "copyAddress" })).toBeTruthy();
        expect(mocks.copy).not.toHaveBeenCalled();
    });
});
