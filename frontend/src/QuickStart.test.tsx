// @vitest-environment jsdom
import i18n from "./i18n";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    waitFor,
} from "@testing-library/react";
vi.mock("./api", () => ({ boot: { title: "Test" } }));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./ui", () => ({
    Modal: ({ children, close }: any) => <div role="dialog"><button onClick={close}>关闭</button>{children}</div>,
}));
import { boot } from "./api";
import { SubscriptionImport } from "./SubscriptionImport";
const copy = vi.fn();
beforeEach(async () => {
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
            "https://example.com/sub?token=test-only&language=zh-CN&flag=sing",
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
 expect(screen.getByRole("button", {name: /FlClash/})).toBeTruthy();
 expect(screen.queryByRole("button", {name: /Shadowrocket/})).toBeNull();
 fireEvent.click(screen.getByRole("button", {name: "iOS"}));
 expect(screen.queryByRole("button", {name: /FlClash/})).toBeNull();
 expect(screen.getByRole("button", {name: /Shadowrocket/})).toBeTruthy();
});

it("disables clients blocked by backend policy and selects an available alternative", () => {
 boot.clientPolicies = { clash: {enabled: false}, singbox: {enabled: true, minVersion: "1.12.0"} };
 try {
  render(<SubscriptionImport inline url="https://example.com/sub?token=test"/>);
  fireEvent.click(screen.getByRole("button", {name: "Windows"}));
  expect((screen.getByRole("button", {name: /Clash Verge Rev/}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", {name: /在 sing-box/})).toBeTruthy();
  expect(screen.getByText(/最低版本：1.12.0/)).toBeTruthy();
 } finally { boot.clientPolicies = undefined; }
});
