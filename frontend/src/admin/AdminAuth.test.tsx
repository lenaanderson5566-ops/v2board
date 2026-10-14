// @vitest-environment jsdom
import { useState } from "react";
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
    boot: { mode: "admin", title: "Local admin", recaptchaSiteKey: "" },
}));
vi.mock("../shared/api", () => ({
    ...mocks,
    admin: (path: string) => "admin/" + path,
    logoutSession: mocks.logout,
}));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/Captcha", () => ({ Captcha: () => null }));
vi.mock("../shared/ui", () => ({
    Editor: ({ fields, onSave, children, submit }: any) => {
        const [body, setBody] = useState<Record<string, string>>({}),
            [error, setError] = useState("");
        return (
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void onSave(body).catch((error: Error) =>
                        setError(error.message),
                    );
                }}
            >
                {fields.map((field: any) => (
                    <label key={field.key}>
                        {field.label}
                        <input
                            type={field.type || "text"}
                            value={body[field.key] || ""}
                            onChange={(event) =>
                                setBody({
                                    ...body,
                                    [field.key]: event.target.value,
                                })
                            }
                        />
                    </label>
                ))}
                {error && <p role="alert">{error}</p>}
                {children}
                <button>{submit}</button>
            </form>
        );
    },
}));
import { AdminAuth } from "./AdminAuth";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
