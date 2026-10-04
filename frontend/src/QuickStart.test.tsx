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
    expect(
        screen.getByRole("link", { name: /在 Hiddify/ }).getAttribute("href"),
    ).toMatch(/^hiddify:\/\//);
    fireEvent.click(screen.getAllByRole("button", { name: "复制订阅链接" })[0]);
    await waitFor(() =>
        expect(copy).toHaveBeenCalledWith(
            "https://example.com/sub?token=test-only&language=zh-CN&flag=sing",
        ),
    );

    expect(screen.getByText("开始使用")).toBeTruthy();
});
