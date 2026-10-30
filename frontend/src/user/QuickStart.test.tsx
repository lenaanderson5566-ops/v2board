// @vitest-environment jsdom
import i18n from "../shared/i18n";
import { Suspense } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    waitFor,
    act,
} from "@testing-library/react";
const startup = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("../shared/api", () => ({ boot: { title: "Test" } }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("../shared/ui", () => ({
    Modal: ({ children, close }: any) => <div role="dialog"><button onClick={close}>关闭</button>{children}</div>,
    useData: (path: string) => {
        startup.paths.push(path);
        return { data: path === "user/info" ? { account_status: { state: "active", is_available: true } }
            : path === "user/getSubscribe" ? { subscribe_url: "https://example.com/sub?token=test-only" } : [], loading: false, error: "", reload: vi.fn() };
    },
    Panel: ({ title, children }: any) => <section><h2>{title}</h2>{children}</section>,
    State: ({ children }: any) => children,
}));
vi.mock("./NodeList", () => ({ NodeList: () => null }));
import { boot } from "../shared/api";
import { SubscriptionImport } from "./SubscriptionImport";
import { Subscribe } from "./SubscribePage";
const copy = vi.fn();
beforeEach(async () => {
    startup.paths = [];
    await i18n.changeLanguage("zh-CN");
    localStorage.clear();
    copy.mockReset();
    copy.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: copy },
    });
});
afterEach(cleanup);
it("offers a light configuration-history link below quick start without requesting records", async () => {
    render(<Suspense fallback={null}><Subscribe /></Suspense>);
    const history = await screen.findByRole("link", { name: "查看配置更新记录" });
    expect(history.getAttribute("href")).toBe("#/security/configuration-updates");
    expect(startup.paths.some(path => path.includes("access-records"))).toBe(false);
    expect(screen.queryByRole("heading", { name: "配置更新记录" })).toBeNull();
});
it("lets users switch systems and copies the correct client format without opening an app", async () => {
    render(
        <SubscriptionImport
            inline
            url="https://example.com/sub?token=test-only"
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    expect(
        screen
            .getByRole("link", { name: /在 Clash Verge/ })
            .getAttribute("href"),
    ).toMatch(/^clash:\/\//);
    fireEvent.click(screen.getByRole("button", { name: "获取客户端" }));
    expect(screen.getByRole("link", { name: /官方下载/ }).getAttribute("href")).toBe("https://github.com/clash-verge-rev/clash-verge-rev/releases");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Android" }));
    expect(screen.queryByRole("button", { name: /Clash Verge/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /sing-box/ }));
    expect(
        screen.getByRole("link", { name: /在 sing-box/ }).getAttribute("href"),
    ).toMatch(/^sing-box:\/\//);
    fireEvent.click(screen.getAllByRole("button", { name: "复制订阅链接" })[0]);
    await waitFor(() =>
        expect(copy).toHaveBeenCalledWith(
            "https://example.com/sub?token=test-only&language=zh-CN&format=sing-box",
        ),
    );

    expect(screen.getByText("开始使用")).toBeTruthy();
});

it("shows ranked recommendations and only compatible alternatives", () => {
 render(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
 fireEvent.click(screen.getByRole("button", {name: "Windows"}));
 expect(screen.queryByRole("button", {name: /Hiddify/})).toBeNull();
 expect(screen.getByRole("button", {name: /sing-box/})).toBeTruthy();

 expect(screen.queryByRole("button", {name: /Hiddify/})).toBeNull();
 expect(screen.queryByRole("button", {name: /FlClash/})).toBeNull();
 fireEvent.click(screen.getByRole("button", {name:"查看全部客户端"}));
 fireEvent.click(screen.getByRole("button", {name:/FlClash/}));
 expect(screen.getByRole("link", {name:/在 FlClash/})).toBeTruthy();
 expect(screen.queryByRole("button", {name: /Shadowrocket/})).toBeNull();
 fireEvent.click(screen.getByRole("button", {name: "iOS"}));
 expect(screen.queryByRole("button", {name: /FlClash/})).toBeNull();
 expect(screen.getByRole("link", {name: /在 Shadowrocket/})).toBeTruthy();
});

it("hides clients blocked by backend policy and selects an available alternative", () => {
 boot.clientPolicies = { clash: {enabled: false}, singbox: {enabled: true, minVersion: "1.12.0"} };
 try {
  render(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
  fireEvent.click(screen.getByRole("button", {name: "Windows"}));
  fireEvent.click(screen.getByRole("button", {name:"查看全部客户端"}));
  expect(screen.queryByRole("button", {name: /Clash Verge Rev/})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:/sing-box/}));
  expect(screen.getByRole("link", {name: /在 sing-box/})).toBeTruthy();
  expect(screen.getByText(/最低版本：1.12.0/)).toBeTruthy();
 } finally { boot.clientPolicies = undefined; }
});
it("closes download access and hides all client entry points when every client is disabled", () => {
    const view=render(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
    fireEvent.click(screen.getByRole("button",{name:"Windows"}));
    fireEvent.click(screen.getByRole("button",{name:"获取客户端"}));
    expect(screen.getByRole("dialog")).toBeTruthy();
    try {
        boot.clientPolicies=Object.fromEntries(["clash","flclash","hiddify","singbox"].map(id=>[id,{enabled:false}]));
        view.rerender(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("button",{name:"获取客户端"})).toBeNull();
        expect(screen.queryByRole("button",{name:"查看全部客户端"})).toBeNull();
        expect(screen.queryByRole("link",{name:/在 .* 中打开/})).toBeNull();
    } finally {delete boot.clientPolicies;}
});

it("uses configured recommendations per platform and keeps default primary when only backup changes",()=>{
 boot.clientRecommendations={windows:["flclash","clash"],android:[null,"flclash"]};
 try {
 render(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
 fireEvent.click(screen.getByRole("button",{name:"Windows"}));
 expect(screen.getByRole("link",{name:/在 FlClash/})).toBeTruthy();
 expect(screen.getByRole("button",{name:/备选.*Clash Verge/})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Android"}));
 expect(screen.getByRole("link",{name:/在 Clash Meta/})).toBeTruthy();
 expect(screen.getByRole("button",{name:/备选.*FlClash/})).toBeTruthy();
 } finally {boot.clientRecommendations=undefined;}
});

it("remembers each platform independently", () => {
 render(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
 fireEvent.click(screen.getByRole("button", {name:"Android"}));
 fireEvent.click(screen.getByRole("button", {name:/sing-box/}));
 fireEvent.click(screen.getByRole("button", {name:"Windows"}));
 expect(screen.getByRole("link", {name:/在 Clash Verge/})).toBeTruthy();
 fireEvent.click(screen.getByRole("button", {name:"Android"}));
 expect(screen.getByRole("link", {name:/在 sing-box/})).toBeTruthy();
 expect(localStorage.getItem("v2board.import-client.android")).toBe("singbox");
});

it("returns from installation to the same selected client and import action", () => {
    render(<SubscriptionImport inline url="https://example.com/sub?token=test" />);
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    fireEvent.click(screen.getByRole("button", { name: /sing-box/ }));
    fireEvent.click(screen.getByRole("button", { name: "获取客户端" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("continueImport", { ns: "clientDownload" }) }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: /在 sing-box/ }).getAttribute("href")).toMatch(/^sing-box:\/\//);
    expect(copy).not.toHaveBeenCalled();
});

it("keeps a selectable manual link available when clipboard access is blocked", async () => {
    copy.mockRejectedValueOnce(new Error("Clipboard denied"));
    render(<SubscriptionImport inline url="https://example.com/sub?token=test" />);
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    fireEvent.click(screen.getByRole("button", { name: "复制订阅链接" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const manual = screen.getByLabelText(i18n.t("manualUrl", { ns: "clientImport" })) as HTMLInputElement;
    expect(manual.closest("details")?.open).toBe(true);
    expect(manual.readOnly).toBe(true);
    expect(manual.value).toBe("https://example.com/sub?token=test&language=zh-CN&format=clash-verge");
    fireEvent.focus(manual);
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(manual.value.length);
});

it("does not show stale copy feedback after changing the client", async () => {
    let complete!: () => void;
    copy.mockReturnValueOnce(new Promise<void>((resolve) => { complete = resolve; }));
    render(<SubscriptionImport inline url="https://example.com/sub?token=test" />);
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    fireEvent.click(screen.getByRole("button", { name: "复制订阅链接" }));
    fireEvent.click(screen.getByRole("button", { name: /sing-box/ }));
    await act(async () => { complete(); });
    expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "复制订阅链接" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy());
    expect(copy).toHaveBeenLastCalledWith("https://example.com/sub?token=test&language=zh-CN&format=sing-box");
});

it("clears copy feedback when the subscription link changes", async () => {
    const view = render(<SubscriptionImport inline url="https://example.com/sub?token=first" />);
    fireEvent.click(screen.getByRole("button", { name: "复制订阅链接" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy());
    view.rerender(<SubscriptionImport inline url="https://example.com/sub?token=updated" />);
    expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
    expect((screen.getByLabelText(i18n.t("manualUrl", { ns: "clientImport" })) as HTMLInputElement).value).toContain("token=updated");
});
it("clears earlier copy success when a later clipboard request fails", async () => {
    render(<SubscriptionImport inline url="https://example.com/sub?token=test" />);
    fireEvent.click(screen.getByRole("button", { name: "复制订阅链接" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy());
    copy.mockRejectedValueOnce(new Error("Clipboard denied"));
    fireEvent.click(screen.getByRole("button", { name: "已复制" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
    expect(screen.getByLabelText(i18n.t("manualUrl", { ns: "clientImport" })).closest("details")?.open).toBe(true);
});
it("offers an explicit completion exit without assuming the client connected", () => {
    render(<SubscriptionImport inline url="https://example.com/sub?token=test" />);
    const finish = i18n.t("finishSetup", { ns: "clientImport", defaultValue: "Setup complete — view usage" });
    expect(screen.getByRole("link", { name: finish }).getAttribute("href")).toBe("#/dashboard");
    expect(screen.getByText(i18n.t("confirmConnection", { ns: "clientImport", defaultValue: "Confirm the connection works in your client before finishing setup." }))).toBeTruthy();
    expect(copy).not.toHaveBeenCalled();
});
it("shows device-specific troubleshooting and clears it when the selection changes", () => {
    const view = render(<SubscriptionImport inline url="https://example.com/sub?token=test" />);
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    const needHelp = () => screen.getByRole("button", { name: i18n.t("needHelp", { ns: "clientImport", defaultValue: "Having trouble?" }) });
    expect(view.container.querySelector(".import-troubleshooting")).toBeNull();
    fireEvent.click(needHelp());
    expect(needHelp().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(i18n.t("helpDesktop", { ns: "clientImport", defaultValue: "Follow the client’s prompts for required system network permissions, then enable the connection." }))).toBeTruthy();
    expect(screen.getByRole("link", { name: "联系客服 / 查看已有工单" }).getAttribute("href")).toBe("#/ticket");
    fireEvent.click(screen.getByRole("button", { name: "iOS" }));
    expect(view.container.querySelector(".import-troubleshooting")).toBeNull();
    fireEvent.click(needHelp());
    expect(screen.getByText(i18n.t("helpIos", { ns: "clientImport", defaultValue: "When iOS asks, allow the client to add its VPN configuration, then enable the connection." }))).toBeTruthy();
    expect(view.container.querySelector(".import-troubleshooting h4")?.textContent).toContain("Shadowrocket");
});
