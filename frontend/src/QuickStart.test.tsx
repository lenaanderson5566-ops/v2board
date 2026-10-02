// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    waitFor,
} from "@testing-library/react";
vi.mock("./api", () => ({ boot: { title: "Test" } }));
vi.mock("./i18n", () => ({
    tx: (key: string, args: any = {}) =>
        key.replace(/{{(\w+)}}/g, (_, name) => String(args[name])),
}));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./ui", () => ({
    Modal: ({ children }: any) => <div role="dialog">{children}</div>,
}));
import { SubscriptionImport } from "./SubscriptionImport";
const copy = vi.fn();
beforeEach(() => {
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
    expect(
        screen.getByRole("link", { name: "获取客户端" }).getAttribute("href"),
    ).toBe("https://github.com/clash-verge-rev/clash-verge-rev/releases");
    fireEvent.click(screen.getByRole("button", { name: "Android" }));
    expect(screen.queryByRole("button", { name: /Clash Verge/ })).toBeNull();
    expect(
        screen.getByRole("link", { name: /在 Hiddify/ }).getAttribute("href"),
    ).toMatch(/^hiddify:\/\//);
    fireEvent.click(screen.getAllByRole("button", { name: "复制订阅链接" })[0]);
    await waitFor(() =>
        expect(copy).toHaveBeenCalledWith(
            "https://example.com/sub?token=test-only&flag=sing",
        ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("开始使用")).toBeTruthy();
});
