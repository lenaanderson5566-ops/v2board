// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => {
    const boot = { mode: "admin", title: "Local admin" } as typeof window.FASTAI;
    window.FASTAI = boot;
    return { request: vi.fn(), logout: vi.fn(), navigate: vi.fn(), boot };
});
vi.mock("../shared/api", () => ({
    ...mocks,
    admin: (path: string) => "admin/" + path,
    logoutSession: mocks.logout,
}));
vi.mock("../shared/Captcha", () => ({ Captcha: () => null }));
import { AdminAuth } from "./AdminAuth";
import { languageReady, setAdminSessionLanguage } from "../shared/i18n";
import { Editor } from "../shared/ui";

beforeAll(async () => {
    await languageReady;
    await setAdminSessionLanguage(false);
});
afterEach(() => {
    cleanup();
    vi.resetAllMocks();
});
it.each(["login", "forget"])("does not treat %s credentials as unsaved configuration", (mode) => {
    const view = render(<AdminAuth mode={mode} onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email address"), {target:{value:"admin@example.test"}});
    fireEvent.change(screen.getByLabelText(mode === "forget" ? "New password" : "Password"), {target:{value:"Example-password-2026"}});
    expect(view.container.querySelector('[data-unsaved="true"]')).toBeNull();
    expect(view.container.querySelector('.admin-dirty-note')).toBeNull();
    const leave = new Event("beforeunload", {cancelable:true});
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
});
it("still protects configuration drafts and removes protection when the editor unmounts", () => {
    const view=render(<Editor fields={[{key:"name",label:"Setting name"}]} initial={{name:"Original"}} onSave={async()=>{}} />);
    fireEvent.change(screen.getByLabelText("Setting name"), {target:{value:"Changed"}});
    expect(view.container.querySelector('[data-unsaved="true"]')).not.toBeNull();
    const leave=new Event("beforeunload",{cancelable:true});
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    view.unmount();
    render(<AdminAuth mode="login" onLogin={vi.fn()} />);
    const afterLogout=new Event("beforeunload",{cancelable:true});
    window.dispatchEvent(afterLogout);
    expect(afterLogout.defaultPrevented).toBe(false);
});
it("does not grant administrator access before MFA is complete", async () => {
    mocks.request.mockImplementation(async (path: string) => ({
        data:
            path === "passport/auth/login"
                ? {
                      mfaRequired: true,
                      challengeId: "a".repeat(64),
                      preferredMethod: "totp",
                      methods: ["totp", "recovery"],
                      expiresAt: "2030-01-01T00:00:00Z",
                  }
                : path === "user/info"
                  ? { email: "admin@example.test" }
                  : { authenticated: true },
    }));
    const login = vi.fn();
    render(<AdminAuth mode="login" onLogin={login} />);
    fireEvent.change(screen.getByLabelText("Email address"), {
        target: { value: "admin@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Login verification" })).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalledWith("admin/config/fetch");
    fireEvent.change(screen.getByLabelText("Verification code"), {
        target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() =>
        expect(login).toHaveBeenCalledWith({ email: "admin@example.test" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("overview");
});
it("retains the default non-MFA flow with an administrator permission check", async () => {
    mocks.request.mockResolvedValue({ data: {} });
    const login = vi.fn();
    render(<AdminAuth mode="login" onLogin={login} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe("#/forget");
    expect(screen.queryByText(/Local admin|ADMIN CONSOLE|管理后台/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Email address"), {
        target: { value: "admin@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenCalledWith("admin/config/fetch");
    expect(screen.queryByRole("link", { name: /create account|sign up/i })).toBeNull();
});

it("sends a reset code and submits the English reset form", async () => {
    mocks.request.mockResolvedValue({ data: true });
    const login = vi.fn();
    render(<AdminAuth mode="forget" onLogin={login} />);
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "admin@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
        "passport/comm/sendEmailVerify", { email: "admin@example.test", isforget: 1 },
    ));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Test-password-2026" } });
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("login"));
    expect(mocks.request).toHaveBeenCalledWith("passport/auth/forget", {
        email: "admin@example.test", password: "Test-password-2026", email_code: "123456",
    });
    expect(login).not.toHaveBeenCalled();
});

it("reports required fields in English before sending a request", () => {
    render(<AdminAuth mode="login" onLogin={vi.fn()} />);
    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText("Password");
    const submit = screen.getByRole("button", { name: "Sign in" });
    fireEvent.click(submit);
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid email address.");
    expect(document.activeElement).toBe(email);

    fireEvent.change(email, { target: { value: "admin@example.test" } });
    fireEvent.click(submit);
    expect(screen.getByRole("alert").textContent).toBe("Enter your password.");
    expect(document.activeElement).toBe(password);
    expect(mocks.request).not.toHaveBeenCalled();
});

it("reveals the entered password only while its visibility toggle is enabled", () => {
    render(<AdminAuth mode="login" onLogin={vi.fn()} />);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "Testing!2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.type).toBe("text");
    expect(password.value).toBe("Testing!2026");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.type).toBe("password");
});

it("keeps raw permission and provider details out of sign-in errors", async () => {
    mocks.request.mockImplementation(async (path: string) => {
        if (path === "admin/config/fetch") throw new Error("管理接口权限不足");
        return { data: { authenticated: true } };
    });
    const login = vi.fn();
    render(<AdminAuth mode="login" onLogin={login} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Test-password-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("Unable to sign in. Check your email and password, then try again.");
    expect(login).not.toHaveBeenCalled();
    expect(mocks.logout).toHaveBeenCalledOnce();
});
