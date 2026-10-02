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
    request: vi.fn(),
    clearReadCache: vi.fn(),
    changeLanguage: vi.fn(),
    language: "en-US",
}));
vi.mock("./api", () => ({
    request: mocks.request,
    clearReadCache: mocks.clearReadCache,
    storageKey: "controls-test",
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./i18n", () => ({
    tx: (key: string) => key,
    locale: () => mocks.language,
    changeLanguage: mocks.changeLanguage,
    languages: [
        { code: "en-US", name: "English" },
        { code: "zh-CN", name: "简体中文" },
    ],
}));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./ui", () => ({
    useData: () => ({ data: { plan: { name: "PRO" }, expired_at: null } }),
    Modal: ({ title, children, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>关闭</button>
            {children}
        </div>
    ),
}));
import { LanguagePicker } from "./LanguagePicker";
import { AccountMenu } from "./AccountMenu";
import { AccountSecurity } from "./AccountSecurity";
afterEach(cleanup);
beforeEach(() => {
    mocks.request.mockReset();
    mocks.clearReadCache.mockReset();
    mocks.changeLanguage.mockReset();
    localStorage.clear();
    sessionStorage.clear();
});
function fill(password = "new-password", confirmation = password) {
    fireEvent.change(screen.getByLabelText("当前密码"), {
        target: { value: "old-password" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
        target: { value: password },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
        target: { value: confirmation },
    });
}
describe("header controls", () => {
    it("selects a language and closes the menu with focus returned", async () => {
        render(<LanguagePicker />);
        const trigger = screen.getByRole("button", { name: "界面语言" });
        fireEvent.click(trigger);
        expect(document.activeElement).toBe(
            screen.getByRole("menuitemradio", { name: "English" }),
        );
        fireEvent.click(
            screen.getByRole("menuitemradio", { name: "简体中文" }),
        );
        expect(mocks.changeLanguage).toHaveBeenCalledWith("zh-CN");
        await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
        expect(document.activeElement).toBe(trigger);
    });
    it("shows a failed save and allows retry without closing the menu", async () => {
        mocks.changeLanguage.mockRejectedValueOnce(Error("save failed"));
        render(<LanguagePicker />);
        fireEvent.click(screen.getByRole("button", { name: "界面语言" }));
        fireEvent.click(screen.getByRole("menuitemradio", { name: "简体中文" }));
        expect(await screen.findByRole("alert")).toHaveProperty("textContent", "save failed");
        expect(screen.getByRole("menu")).toBeTruthy();
        fireEvent.click(screen.getByRole("menuitemradio", { name: "简体中文" }));
        await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
        expect(mocks.changeLanguage).toHaveBeenCalledTimes(2);
    });
    it("supports keyboard navigation and Escape", () => {
        render(<LanguagePicker />);
        const trigger = screen.getByRole("button", { name: "界面语言" });
        fireEvent.click(trigger);
        fireEvent.keyDown(document, { key: "ArrowDown" });
        expect(document.activeElement).toBe(
            screen.getByRole("menuitemradio", { name: "简体中文" }),
        );
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
    it("opens only one header menu and offers the account security route", () => {
        render(
            <>
                <LanguagePicker />
                <AccountMenu
                    user={{ email: "alex@example.com" }}
                    logout={vi.fn()}
                />
            </>,
        );
        fireEvent.click(screen.getByRole("button", { name: "界面语言" }));
        fireEvent.click(screen.getByRole("button", { name: "account" }));
        expect(screen.queryByRole("menu")).toBeNull();
        expect(
            screen.getByRole("link", { name: "账户安全" }).getAttribute("href"),
        ).toBe("#/security");
        expect(
            screen.getByRole("link", { name: "通知设置" }).getAttribute("href"),
        ).toBe("#/notifications");
        expect(screen.queryByRole("link", { name: "订单记录" })).toBeNull();
        expect(screen.queryByRole("link", { name: "帮助中心" })).toBeNull();
        expect(screen.queryByRole("link", { name: "流量记录" })).toBeNull();
        expect(screen.getByText("A")).toBeTruthy();
        expect(screen.getByText("PRO")).toBeTruthy();
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole("link", { name: "账户安全" })).toBeNull();
    });
});
describe("account password changes", () => {
    it("requires confirmation to reset configuration credentials without logging out or revealing the URL", async () => {
        mocks.request.mockResolvedValue({
            data: "https://example.com/sub?token=hidden",
        });
        localStorage.setItem("controls-test", "test-session");
        render(<AccountSecurity />);
        fireEvent.click(screen.getByRole("button", { name: "重置订阅链接" }));
        expect(mocks.request).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "取消" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "重置订阅链接" }));
        fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(mocks.request).toHaveBeenCalledWith("user/resetSecurity", {});
        expect(localStorage.getItem("controls-test")).toBe("test-session");
        expect(screen.queryByText(/token=hidden/)).toBeNull();
        expect(
            screen.getByRole("link", { name: "配置中心" }).getAttribute("href"),
        ).toBe("#/subscribe");
    });
    it("rejects mismatched confirmation before contacting Laravel", () => {
        render(<AccountSecurity />);
        fill("new-password", "different-password");
        fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
        expect(screen.getByRole("alert").textContent).toBe(
            "两次输入的新密码不一致。",
        );
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("clears the current session after success and saves a re-login notice", async () => {
        mocks.request.mockResolvedValue({ data: true });
        localStorage.setItem("controls-test", "test-session");
        const expired = vi.fn();
        window.addEventListener("auth-expired", expired);
        try {
            render(<AccountSecurity />);
            fill();
            fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
            await waitFor(() => expect(expired).toHaveBeenCalledOnce());
            expect(mocks.request).toHaveBeenCalledWith("user/changePassword", {
                old_password: "old-password",
                new_password: "new-password",
            });
            expect(localStorage.getItem("controls-test")).toBeNull();
            expect(
                sessionStorage.getItem("controls-test.passwordUpdated"),
            ).toBe("1");
            expect(mocks.clearReadCache).toHaveBeenCalledOnce();
        } finally {
            window.removeEventListener("auth-expired", expired);
        }
    });
    it("preserves the login session and shows backend errors after failure", async () => {
        mocks.request.mockRejectedValue(new Error("旧密码错误"));
        localStorage.setItem("controls-test", "test-session");
        render(<AccountSecurity />);
        fill();
        fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
        await waitFor(() =>
            expect(screen.getByRole("alert").textContent).toBe("旧密码错误"),
        );
        expect(localStorage.getItem("controls-test")).toBe("test-session");
    });
});
