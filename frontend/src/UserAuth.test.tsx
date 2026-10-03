// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
    cleanup,
    render,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    navigate: vi.fn(),
    boot: {
        title: "Local test",
        mode: "user",
        emailVerify: true,
        registerClosed: false,
        inviteRequired: false,
        emailWhitelistEnabled: false,
        emailWhitelistSuffixes: [] as string[],
        recaptchaSiteKey: "",
        tosUrl: "",
    },
}));
vi.mock("./api", () => ({ ...mocks, storageKey: "auth-flow-test" }));
vi.mock("./i18n", () => ({
    tx: (key: string) => key,
    locale: () => "ja-JP",
    loginLanguagePreference: () => ({
        language: "ja-JP",
        language_selected: true,
    }),
    applyAccountLanguage: vi.fn(),
}));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./ux", () => ({ ux: (key: string) => key }));
import { UserAuth } from "./UserAuth";
function page(mode = "register") {
    const onLogin = vi.fn();
    const view = render(
        <UserAuth
            mode={mode}
            onLogin={onLogin}
            renderCaptcha={(onChange) => (
                <button
                    type="button"
                    onClick={() => onChange("fresh-challenge")}
                >
                    captcha
                </button>
            )}
        />,
    );
    return { ...view, onLogin };
}
function credentials() {
    fireEvent.change(screen.getByLabelText("邮箱地址"), {
        target: { value: "review@example.test" },
    });
    fireEvent.change(screen.getByLabelText("密码", { exact: true }), {
        target: { value: "A-long-test-phrase!23" },
    });
}
beforeEach(() => {
    mocks.request.mockReset();
    mocks.navigate.mockReset();
    mocks.boot.emailVerify = true;
    mocks.boot.registerClosed = false;
    mocks.boot.inviteRequired = false;
    mocks.boot.emailWhitelistEnabled = false;
    mocks.boot.emailWhitelistSuffixes = [];
    mocks.boot.recaptchaSiteKey = "";
    mocks.boot.tosUrl = "";
    localStorage.clear();
    sessionStorage.clear();
    location.hash = "";
    mocks.request.mockImplementation(async (path: string) =>
        path === "passport/auth/login"
            ? { data: { auth_data: "test-session" } }
            : path === "user/info"
              ? { data: { email: "review@example.test" } }
              : { data: true },
    );
});
it("shows the suspension entry when authenticated credentials are denied as banned", async () => {
    mocks.request.mockRejectedValue(
        Object.assign(new Error("Suspended"), { code: "ACCOUNT_BANNED" }),
    );
    const view = page("login");
    credentials();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() =>
        expect(
            screen.getByRole("heading", { name: "bannedTitle" }),
        ).toBeTruthy(),
    );
    expect(view.onLogin).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("密码", { exact: true })).toBeNull();
});
afterEach(cleanup);
describe("user account steps", () => {
    it("explains email-only registration when an invitation is required", () => {
        mocks.boot.inviteRequired = true;
        page();
        expect(screen.getByRole("alert").textContent).toBe(
            "本站采用邮件邀请注册，请从邀请邮件中的链接继续。",
        );
        expect(screen.queryByLabelText("邮箱地址")).toBeNull();
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it("accepts a recipient-bound email invitation without a public code input", async () => {
        mocks.boot.emailVerify = false;
        mocks.boot.inviteRequired = true;
        const token = "a".repeat(64);
        location.hash = `#/register?invitation=${token}&email=friend%40example.com`;
        page();
        const email = screen.getByLabelText("邮箱地址") as HTMLInputElement;
        expect(email.value).toBe("friend@example.com");
        expect(email.readOnly).toBe(true);
        expect(screen.queryByLabelText("邀请码")).toBeNull();
        fireEvent.change(screen.getByLabelText("密码", { exact: true }), {
            target: { value: "A-long-test-phrase!23" },
        });
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "review" });
        fireEvent.click(screen.getByRole("button", { name: "注册账户" }));
        await waitFor(() =>
            expect(mocks.request).toHaveBeenCalledWith(
                "passport/auth/register",
                expect.objectContaining({
                    email: "friend@example.com",
                    invitation: token,
                }),
            ),
        );
        expect(mocks.request.mock.calls[0][1]).not.toHaveProperty(
            "invite_code",
        );
    });
    it("shows and consumes the password update notice on the login page", () => {
        sessionStorage.setItem("auth-flow-test.passwordUpdated", "1");
        page("login");
        expect(screen.getByRole("status").textContent).toBe(
            "密码已更新，请重新登录。",
        );
        expect(
            sessionStorage.getItem("auth-flow-test.passwordUpdated"),
        ).toBeNull();
    });
    it("sends a code first and registers only after the verification step", async () => {
        const { onLogin } = page();
        credentials();
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "verify" });
        expect(mocks.request).toHaveBeenCalledTimes(1);
        expect(mocks.request).toHaveBeenCalledWith(
            "passport/comm/sendEmailVerify",
            expect.objectContaining({
                email: "review@example.test",
                isforget: 0,
            }),
        );
        expect(
            (
                screen.getByRole("button", {
                    name: /秒后重试/,
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
        fireEvent.change(screen.getByLabelText("邮箱验证码"), {
            target: { value: "123456" },
        });
        fireEvent.click(screen.getByRole("button", { name: "create" }));
        await waitFor(() =>
            expect(onLogin).toHaveBeenCalledWith({
                email: "review@example.test",
            }),
        );
        expect(mocks.request.mock.calls.map((call) => call[0])).toEqual([
            "passport/comm/sendEmailVerify",
            "passport/auth/register",
            "passport/auth/login",
            "user/info",
        ]);
        expect(mocks.request.mock.calls[1][1]).toMatchObject({
            email_code: "123456",
            language: "ja-JP",
            password: "A-long-test-phrase!23",
        });
        expect(mocks.navigate).toHaveBeenCalledWith("dashboard");
    });
    it("keeps account details when going back and handles mail failures in place", async () => {
        page();
        credentials();
        mocks.request.mockRejectedValueOnce(
            Error("mail temporarily unavailable"),
        );
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("alert");
        expect(screen.getByRole("heading", { name: "创建账户" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "verify" });
        fireEvent.click(screen.getByRole("button", { name: "edit" }));
        expect(
            (screen.getByLabelText("邮箱地址") as HTMLInputElement).value,
        ).toBe("review@example.test");
        expect(
            (screen.getByLabelText("密码", { exact: true }) as HTMLInputElement)
                .value,
        ).toBe("A-long-test-phrase!23");
    });
    it("offers account review without sending mail when email verification is disabled", async () => {
        mocks.boot.emailVerify = false;
        page();
        credentials();
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "review" });
        expect(mocks.request).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "注册账户" }));
        await waitFor(() =>
            expect(mocks.navigate).toHaveBeenCalledWith("dashboard"),
        );
        expect(mocks.request.mock.calls[0][0]).toBe("passport/auth/register");
    });
    it("uses the reset intent and clears the password after resetting", async () => {
        page("forget");
        fireEvent.change(screen.getByLabelText("邮箱地址"), {
            target: { value: "review@example.test" },
        });
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "verify" });
        expect(mocks.request.mock.calls[0][1].isforget).toBe(1);
        fireEvent.change(screen.getByLabelText("邮箱验证码"), {
            target: { value: "654321" },
        });
        fireEvent.change(screen.getByLabelText("新密码", { exact: true }), {
            target: { value: "Another-test-phrase!23" },
        });
        fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
        await screen.findByText("resetDone");
        expect(mocks.request.mock.calls[1]).toEqual([
            "passport/auth/forget",
            expect.objectContaining({ email_code: "654321" }),
        ]);
        expect(screen.queryByLabelText("新密码", { exact: true })).toBeNull();
    });
    it("retries login without creating the account twice after a transient failure", async () => {
        mocks.boot.emailVerify = false;
        let logins = 0;
        mocks.request.mockImplementation(async (path: string) => {
            if (path === "passport/auth/login") {
                if (++logins === 1) throw Error("temporary login error");
                return { data: { auth_data: "test-session" } };
            }
            return {
                data:
                    path === "user/info"
                        ? { email: "review@example.test" }
                        : true,
            };
        });
        const { onLogin } = page();
        credentials();
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "review" });
        fireEvent.click(screen.getByRole("button", { name: "注册账户" }));
        await screen.findByRole("alert");
        fireEvent.click(screen.getByRole("button", { name: "注册账户" }));
        await waitFor(() => expect(onLogin).toHaveBeenCalled());
        expect(
            mocks.request.mock.calls.filter(
                (call) => call[0] === "passport/auth/register",
            ),
        ).toHaveLength(1);
    });
    it("requires a new challenge after sending email rather than reusing the previous token", async () => {
        mocks.boot.recaptchaSiteKey = "test-key";
        page();
        credentials();
        fireEvent.click(screen.getByRole("button", { name: "captcha" }));
        fireEvent.click(screen.getByRole("button", { name: "next" }));
        await screen.findByRole("heading", { name: "verify" });
        fireEvent.change(screen.getByLabelText("邮箱验证码"), {
            target: { value: "123456" },
        });
        fireEvent.click(screen.getByRole("button", { name: "create" }));
        await screen.findByRole("alert");
        expect(mocks.request).toHaveBeenCalledTimes(1);
    });
});

it("replaces open signup with invitation guidance on the login page", () => {
    mocks.boot.inviteRequired = true;
    page("login");
    expect(screen.queryByRole("link", { name: "创建账户" })).toBeNull();
    expect(screen.getByRole("link", { name: "了解注册方式" })).toBeTruthy();
});
it("blocks malformed invitations before showing account fields", () => {
    mocks.boot.inviteRequired = true;
    location.hash = "#/register?invitation=bad&email=a%40example.test";
    page();
    expect(screen.getByRole("alert").textContent).toContain("邀请链接不完整");
    expect(screen.queryByLabelText("邮箱地址")).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("shows allowed domains and stops disallowed addresses before sending codes", async () => {
    mocks.boot.emailWhitelistEnabled = true;
    mocks.boot.emailWhitelistSuffixes = ["QQ.COM", "gmail.com"];
    page();
    expect(screen.getByText("@qq.com")).toBeTruthy();
    credentials();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
            "此邮箱域名暂不支持注册",
        ),
    );
    expect(mocks.request).not.toHaveBeenCalled();
});
it("accepts allowed email domains regardless of case", async () => {
    mocks.boot.emailWhitelistEnabled = true;
    mocks.boot.emailWhitelistSuffixes = ["@EXAMPLE.TEST"];
    page();
    credentials();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByRole("heading", { name: "verify" });
    expect(mocks.request).toHaveBeenCalledWith(
        "passport/comm/sendEmailVerify",
        expect.objectContaining({ email: "review@example.test" }),
    );
});
it("passes the bound invitation when requesting registration verification", async () => {
    const invitation = "a".repeat(64);
    mocks.boot.inviteRequired = true;
    location.hash = `#/register?invitation=${invitation}&email=friend%40example.test`;
    page();
    fireEvent.change(screen.getByLabelText("密码", { exact: true }), {
        target: { value: "Long-password!234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByRole("heading", { name: "verify" });
    expect(mocks.request).toHaveBeenCalledWith(
        "passport/comm/sendEmailVerify",
        expect.objectContaining({
            invitation,
            email: "friend@example.test",
            isforget: 0,
        }),
    );
});
it("does not restrict password recovery for existing accounts", async () => {
    mocks.boot.emailWhitelistEnabled = true;
    mocks.boot.emailWhitelistSuffixes = ["qq.com"];
    mocks.boot.inviteRequired = true;
    page("forget");
    expect(screen.queryByText("允许注册的邮箱")).toBeNull();
    fireEvent.change(screen.getByLabelText("邮箱地址"), {
        target: { value: "review@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByRole("heading", { name: "verify" });
    expect(mocks.request).toHaveBeenCalledWith(
        "passport/comm/sendEmailVerify",
        expect.objectContaining({ isforget: 1, email: "review@example.test" }),
    );
});
