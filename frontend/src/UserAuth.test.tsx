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
        recaptchaSiteKey: "",
        tosUrl: "",
    },
}));
vi.mock("./api", () => ({ ...mocks, storageKey: "auth-flow-test" }));
vi.mock("./i18n", () => ({ tx: (key: string) => key }));
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
    mocks.boot.recaptchaSiteKey = "";
    mocks.boot.tosUrl = "";
    localStorage.clear();
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
    mocks.request.mockRejectedValue(Object.assign(new Error("Suspended"), {code: "ACCOUNT_BANNED"}));
    const view = page("login");
    credentials();
    fireEvent.click(screen.getByRole("button", {name: "登录"}));
    await waitFor(() => expect(screen.getByRole("heading", {name: "bannedTitle"})).toBeTruthy());
    expect(view.onLogin).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("密码", {exact:true})).toBeNull();
});
afterEach(cleanup);
describe("user account steps", () => {
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
