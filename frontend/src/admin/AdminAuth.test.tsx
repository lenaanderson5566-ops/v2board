// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    logout: vi.fn(),
    navigate: vi.fn(),
    boot: { mode: "admin", title: "Local admin" },
}));
vi.mock("../shared/api", () => ({
    ...mocks,
    admin: (path: string) => "admin/" + path,
    logoutSession: mocks.logout,
}));
vi.mock("../shared/i18n", async (original) => ({ ...(await original<typeof import("../shared/i18n")>()), tx: (key: string) => key }));
vi.mock("../shared/Captcha", () => ({ Captcha: () => null }));
import { AdminAuth } from "./AdminAuth";
import { Editor } from "../shared/ui";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it.each(["login", "forget"])("does not treat %s credentials as unsaved configuration", (mode) => {
    const view = render(<AdminAuth mode={mode} onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/邮箱地址/), {target:{value:"admin@example.test"}});
    fireEvent.change(screen.getByLabelText(mode === "forget" ? /新密码/ : /^密码/), {target:{value:"Example-password-2026"}});
    expect(view.container.querySelector('[data-unsaved="true"]')).toBeNull();
    expect(view.container.querySelector('.admin-dirty-note')).toBeNull();
    const leave = new Event("beforeunload", {cancelable:true});
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
});
it("still protects configuration drafts and removes protection when the editor unmounts", () => {
    const view=render(<Editor fields={[{key:"name",label:"配置名称"}]} initial={{name:"Original"}} onSave={async()=>{}} />);
    fireEvent.change(screen.getByLabelText("配置名称"), {target:{value:"Changed"}});
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
    fireEvent.change(screen.getByLabelText("邮箱地址"), {
        target: { value: "admin@example.test" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("登录安全验证")).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalledWith("admin/config/fetch");
    fireEvent.change(screen.getByLabelText("验证码"), {
        target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));
    await waitFor(() =>
        expect(login).toHaveBeenCalledWith({ email: "admin@example.test" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("overview");
});
it("retains the default non-MFA flow with an administrator permission check", async () => {
    mocks.request.mockResolvedValue({ data: {} });
    const login = vi.fn();
    render(<AdminAuth mode="login" onLogin={login} />);
    fireEvent.change(screen.getByLabelText("邮箱地址"), {
        target: { value: "admin@example.test" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenCalledWith("admin/config/fetch");
    expect(screen.queryByText("创建账户")).toBeNull();
});
