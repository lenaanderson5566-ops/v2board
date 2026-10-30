// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    act,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    embedded: "WeChat" as string | null,
    policy: "guide" as "allow" | "prompt" | "guide",
    mode: "user",
    device: "ios",
    action: vi.fn(),
    copy: vi.fn(),
}));
vi.mock("../shared/user-experience", () => ({
    currentDevice: () => ({ embedded: mocks.embedded, device: mocks.device }),
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
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
import { useEffect } from "react";
import { browserHandoffUrl, browserPolicy } from "../shared/browser-access";
import {
    EmbeddedBrowserNotice,
    BrowserAccessGate,
} from "./EmbeddedBrowserNotice";
import { BrowserNoticeView } from "../shared/ui/BrowserNoticeView";
import { BrowserHandoffHelp } from "./BrowserHandoffHelp";
beforeEach(() => {
    mocks.embedded = "WeChat";
    mocks.copy.mockReset();
    mocks.action.mockReset();
    mocks.mode = "user";
    mocks.device = "ios";
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
    it.each(["guide", "prompt"] as const)("keeps the %s public entry neutral without exposing workspace descriptions", policy => {
        mocks.policy = policy;
        render(<BrowserAccessGate><p>private workspace content</p></BrowserAccessGate>);
        expect(screen.getByRole("heading", {name:"browserEntryTitle", level:1})).toBeTruthy();
        expect(screen.getByText("browserEntryIntro")).toBeTruthy();
        expect(screen.queryByText("browserReason")).toBeNull();
        expect(screen.queryByText("browserSessionNote")).toBeNull();
        expect(screen.queryByText("browserGuidePolicy")).toBeNull();
        expect(screen.queryByText("private workspace content")).toBeNull();
        expect(Boolean(screen.queryByText("browserEntryPrompt"))).toBe(policy === "prompt");
        expect(Boolean(screen.queryByRole("button", {name:"browserContinue"}))).toBe(policy === "prompt");
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
        await waitFor(() => {
            expect(document.activeElement).toBe(address);
            expect((address as HTMLInputElement).selectionStart).toBe(0);
            expect((address as HTMLInputElement).selectionEnd).toBe(location.href.length);
        });
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
        expect(document.activeElement).toBe(screen.getByRole("textbox"));
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

it.each(["windows", "macos", "linux", "unknown"])("gives copy-and-paste guidance without guessing app menus on %s", device => {
    mocks.device = device;
    render(<EmbeddedBrowserNotice />);
    expect(screen.queryByText("browserMenu")).toBeNull();
    expect(screen.queryByText("browserMenuDetail")).toBeNull();
    expect(screen.getByText("browserOpenCopied")).toBeTruthy();
    expect(screen.getByText("browserExternalStep")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

it("does not guess menu placement in an unidentified mobile app", () => {
    mocks.embedded = "Other";
    render(<EmbeddedBrowserNotice />);
    expect(screen.getByText("browserMenuUnknown")).toBeTruthy();
    expect(screen.queryByText("browserMenuDetail")).toBeNull();
});

it("revokes a continued prompt when the policy or app changes", () => {
    mocks.policy = "prompt";
    const view = render(<BrowserAccessGate><p>account content</p></BrowserAccessGate>);
    fireEvent.click(screen.getByRole("button", {name:"browserContinue"}));
    expect(screen.getByText("account content")).toBeTruthy();
    mocks.policy = "guide";
    view.rerender(<BrowserAccessGate><p>account content</p></BrowserAccessGate>);
    expect(screen.queryByText("account content")).toBeNull();
    expect(screen.queryByRole("button", {name:"browserContinue"})).toBeNull();
    mocks.policy = "prompt";
    view.rerender(<BrowserAccessGate><p>account content</p></BrowserAccessGate>);
    expect(screen.queryByText("account content")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name:"browserContinue"}));
    mocks.embedded = "QQ";
    view.rerender(<BrowserAccessGate><p>account content</p></BrowserAccessGate>);
    expect(screen.queryByText("account content")).toBeNull();
});

it("uses the latest safe route after hash and history navigation", async () => {
    mocks.copy.mockResolvedValue(undefined);
    render(<EmbeddedBrowserNotice />);
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    await screen.findByRole("button", {name:"已复制"});
    act(() => {
        history.replaceState(null,"","/app#/order/order-one?token=private");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.queryByRole("button", {name:"已复制"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    await waitFor(() => expect(mocks.copy).toHaveBeenLastCalledWith(location.origin+"/app#/order/order-one"));
    act(() => {
        history.replaceState(null,"","/app#/order/order-two");
        window.dispatchEvent(new PopStateEvent("popstate"));
    });
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    await waitFor(() => expect(mocks.copy).toHaveBeenLastCalledWith(location.origin+"/app#/order/order-two"));
});

it("ignores a late clipboard result after the address changes", async () => {
    let finish!: () => void;
    mocks.copy.mockImplementationOnce(() => new Promise<void>(resolve => {finish=resolve;})).mockResolvedValueOnce(undefined);
    render(<EmbeddedBrowserNotice />);
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    act(() => {
        history.replaceState(null,"","/#/order/new-order");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    await screen.findByRole("button", {name:"已复制"});
    await act(async () => {finish();});
    expect(mocks.action.mock.calls.filter(([event])=>event==="copy_success")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("browserCopied");
});

it("ignores a stale clipboard rejection after navigation or unmount", async () => {
    let fail!: (cause: Error) => void;
    mocks.copy.mockImplementation(() => new Promise<void>((_,reject) => {fail=reject;}));
    const view=render(<EmbeddedBrowserNotice />);
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    act(() => {
        history.replaceState(null,"","/#/order/new-order");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await act(async () => {fail(new Error("old address"));});
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name:"copyAddress"}));
    view.unmount();
    await act(async () => {fail(new Error("unmounted"));});
    expect(mocks.action).not.toHaveBeenCalled();
});

it("does not steal focus when a clipboard failure arrives after the user moves on", async () => {
    let fail!: (cause: Error) => void;
    mocks.copy.mockImplementation(() => new Promise<void>((_,reject) => {fail=reject;}));
    render(<><EmbeddedBrowserNotice /><button>another action</button></>);
    const copy=screen.getByRole("button",{name:"copyAddress"});
    copy.focus();
    fireEvent.click(copy);
    const other=screen.getByRole("button",{name:"another action"});
    other.focus();
    await act(async()=>{fail(new Error("denied"));});
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(document.activeElement).toBe(other);
});

it("reuses the guidance in a form without submitting or claiming a mandatory restriction", async () => {
    const submit=vi.fn();
    mocks.copy.mockResolvedValue(undefined);
    render(<form onSubmit={event=>{event.preventDefault();submit();}}><EmbeddedBrowserNotice compact /></form>);
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.queryByRole("heading",{level:1})).toBeNull();
    expect(screen.queryByText("browserGuidePolicy")).toBeNull();
    expect(screen.getByRole("heading", {name:"browserTitle", level:2})).toBeTruthy();
    expect(screen.getByText("browserReason")).toBeTruthy();
    expect(screen.getByText("browserSessionNote")).toBeTruthy();
    expect(screen.queryByText("browserEntryIntro")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"copyAddress"}));
    await screen.findByRole("button",{name:"已复制"});
    fireEvent.click(screen.getByRole("button",{name:"browserManual"}));
    expect(submit).not.toHaveBeenCalled();
});

it("keeps preview copying and actions separate from real clipboard and analytics", async () => {
    const continuePreview=vi.fn();
    render(<BrowserNoticeView preview embedded="WeChat" device="ios" title="Preview"
        address="https://example.test/#/login" copy={mocks.copy} onAction={mocks.action} onContinue={continuePreview}/>);
    fireEvent.click(screen.getByRole("button",{name:"copyAddress"}));
    await waitFor(()=>expect(screen.getByRole("status").textContent).toBe("browserPreviewCopied"));
    expect(screen.queryByRole("button",{name:"已复制"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"browserManual"}));
    fireEvent.click(screen.getByRole("button",{name:"browserContinue"}));
    expect(continuePreview).toHaveBeenCalledTimes(1);
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
});

it("offers a clear recovery when there is no safe address to hand off", () => {
    render(<BrowserNoticeView embedded="WeChat" device="ios" title="Example" address="" copy={mocks.copy}/>);
    const copy=screen.getByRole("button",{name:"copyAddress"}) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(screen.getByText("browserCopyUnavailable")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"browserManual"})).toBeNull();
    expect(mocks.copy).not.toHaveBeenCalled();
});

it("opens and closes contextual browser help without remounting the business page", async () => {
    history.replaceState(null,"","/app?token=private#/order/order-one?verify=proof");
    const started=vi.fn();
    function Business() {
        useEffect(started,[]);
        return <p>current business content</p>;
    }
    mocks.copy.mockResolvedValue(undefined);
    render(<><Business/><BrowserHandoffHelp context="payment"/></>);
    const business=screen.getByText("current business content");
    const entry=screen.getByRole("button",{name:"browserPaymentHelp"});
    entry.focus();
    fireEvent.click(entry);
    const dialog=screen.getByRole("dialog",{name:"browserHelpTitle"});
    expect(dialog.querySelector("main,h1")).toBeNull();
    expect(screen.queryByText("browserGuidePolicy")).toBeNull();
    expect(screen.queryByRole("button",{name:"browserContinue"})).toBeNull();
    expect(screen.getByText("browserSessionNote")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"copyAddress"}));
    await waitFor(()=>expect(mocks.copy).toHaveBeenCalledWith(location.origin+"/app#/order/order-one"));
    fireEvent.click(screen.getByRole("button",{name:"关闭"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("current business content")).toBe(business);
    expect(started).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(entry);
    expect(mocks.action.mock.calls.some(([event])=>event==="guide_continue")).toBe(false);
});

it("does not open contextual guidance while disabled or in an ordinary browser", () => {
    const view=render(<BrowserHandoffHelp context="setup" disabled/>);
    const entry=screen.getByRole("button",{name:"browserSetupHelp"}) as HTMLButtonElement;
    expect(entry.disabled).toBe(true);
    fireEvent.click(entry);
    expect(screen.queryByRole("dialog")).toBeNull();
    mocks.embedded=null;
    view.rerender(<BrowserHandoffHelp context="setup"/>);
    expect(screen.queryByRole("button",{name:"browserSetupHelp"})).toBeNull();
});
