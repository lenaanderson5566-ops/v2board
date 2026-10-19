// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    embedded: "WeChat" as string | null,
    policy: "guide" as "allow" | "prompt" | "guide",
    mode: "user",
    action: vi.fn(),
    copy: vi.fn(),
}));
vi.mock("../shared/user-experience", () => ({
    currentDevice: () => ({ embedded: mocks.embedded, device: "ios" }),
}));
vi.mock("../shared/api", () => ({
    boot: {
        title: "Example AI",
        get mode() {
            return mocks.mode;
        },
        get browserPolicies() {
            return { wechat: mocks.policy };
        },
    },
}));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({
    e: (key: string, values?: { app: string }) =>
        values ? `${key} ${values.app}` : key,
}));
vi.mock("./product-analytics", () => ({
    useAnalyticsPage: vi.fn(),
    trackAction: mocks.action,
}));
vi.mock("../shared/LanguagePicker", () => ({ LanguagePicker: () => null }));
import { useEffect } from "react";
import { browserHandoffUrl, browserPolicy } from "../shared/browser-access";
import {
    EmbeddedBrowserNotice,
    BrowserAccessGate,
} from "./EmbeddedBrowserNotice";
beforeEach(() => {
    mocks.embedded = "WeChat";
    mocks.copy.mockReset();
    mocks.action.mockReset();
    mocks.mode = "user";
    mocks.policy = "guide";
    history.replaceState(null, "", "/");
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: mocks.copy },
    });
});
afterEach(cleanup);
describe("in-app browser guidance", () => {
    it("does not block a regular browser", () => {
        mocks.embedded = null;
        const view = render(<EmbeddedBrowserNotice />);
        expect(view.container.textContent).toBe("");
    });
    it.each([
        ["WeChat", "wechat"],
        ["QQ", "qq"],
        ["Weibo", "weibo"],
    ])("names %s and shows two clear steps", (app, label) => {
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
        await waitFor(() =>
            expect(screen.getByRole("status").textContent).toBe(
                "browserCopied",
            ),
        );
        expect(mocks.copy).toHaveBeenCalledWith(location.href);
        expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("reveals a selectable address when clipboard access is denied", async () => {
        mocks.copy.mockRejectedValue(Error("denied"));
        render(<EmbeddedBrowserNotice />);
        fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
        const address = await screen.findByRole("textbox", {
            name: "copyAddress",
        });
        expect((address as HTMLInputElement).value).toBe(location.href);
        expect(screen.getByRole("status").textContent).toBe("browserCopyHelp");
        mocks.copy.mockResolvedValue(undefined);
        fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
        await waitFor(() =>
            expect(screen.getByRole("status").textContent).toBe(
                "browserCopied",
            ),
        );
    });
    it("allows manual copying without requiring clipboard permission", () => {
        render(<EmbeddedBrowserNotice />);
        fireEvent.click(screen.getByRole("button", { name: "browserManual" }));
        expect(
            screen.getByRole("textbox", { name: "copyAddress" }),
        ).toBeTruthy();
        expect(mocks.copy).not.toHaveBeenCalled();
    });
});

it("does not mount business effects before continuing a prompt", () => {
    const started = vi.fn();
    function Business() {
        useEffect(started, []);
        return <p>account content</p>;
    }
    mocks.policy = "prompt";
    render(
        <BrowserAccessGate>
            <Business />
        </BrowserAccessGate>,
    );
    expect(started).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "browserContinue" }));
    expect(screen.getByText("account content")).toBeTruthy();
    expect(started).toHaveBeenCalledTimes(1);
    expect(mocks.action).toHaveBeenCalledWith(
        "guide_continue",
        "browser_prompt",
    );
});
it("guide has no continue button and admin entry is never blocked", () => {
    const view = render(
        <BrowserAccessGate>
            <p>admin content</p>
        </BrowserAccessGate>,
    );
    expect(screen.queryByText("admin content")).toBeNull();
    expect(
        screen.queryByRole("button", { name: "browserContinue" }),
    ).toBeNull();
    mocks.mode = "admin";
    view.rerender(
        <BrowserAccessGate>
            <p>admin content</p>
        </BrowserAccessGate>,
    );
    expect(screen.getByText("admin content")).toBeTruthy();
});
it("allow enters directly and unknown browsers default to allow", () => {
    mocks.policy = "allow";
    render(
        <BrowserAccessGate>
            <p>site</p>
        </BrowserAccessGate>,
    );
    expect(screen.getByText("site")).toBeTruthy();
    expect(browserPolicy(null, { wechat: "guide" })).toBe("allow");
    expect(browserPolicy("Other")).toBe("allow");
    expect(browserPolicy("Weibo")).toBe("guide");
    expect(browserPolicy("WeChat", { wechat: "bad" as any })).toBe("guide");
});
it("copies a clean deep link without authentication proofs", async () => {
    history.replaceState(
        null,
        "",
        "/app?token=secret#/login?verify=secret&code=invite",
    );
    mocks.copy.mockResolvedValue(undefined);
    render(<EmbeddedBrowserNotice />);
    fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
    await waitFor(() =>
        expect(mocks.copy).toHaveBeenCalledWith(
            location.origin + "/app#/login?code=invite",
        ),
    );
    expect(mocks.action).toHaveBeenCalledWith("copy_success", "browser_guide");
    expect(
        browserHandoffUrl(
            "https://example.test/app#/client-authorize?authorizationId=secret",
        ),
    ).toBe("https://example.test/app#/login");
});
it("preserves only the validated invitation registration pair", () => {
    const invitation = "a".repeat(64);
    const url = browserHandoffUrl(
        `https://example.test/app#/register?invitation=${invitation}&email=a%40example.test&verify=secret`,
    );
    expect(url).toContain(`invitation=${invitation}&email=a%40example.test`);
    expect(url).not.toContain("verify");
});
it("handles missing clipboard APIs with manual copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
    });
    render(<EmbeddedBrowserNotice />);
    fireEvent.click(screen.getByRole("button", { name: "copyAddress" }));
    expect(await screen.findByRole("textbox")).toBeTruthy();
    expect(mocks.action).toHaveBeenCalledWith("copy_failed", "browser_guide");
});
