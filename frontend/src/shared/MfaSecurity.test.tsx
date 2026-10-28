vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
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
    forget: vi.fn(),
    clear: vi.fn(),
    state: {
        enrollmentEnabled: true,
        emailEnabled: false,
        totpEnabled: false,
        recoveryCodesRemaining: 0,
    },
}));
vi.mock("./api", () => ({
    request: mocks.request,
    clearReadCache: mocks.clear,
}));
vi.mock("./browser-session", () => ({ forgetBrowserSession: mocks.forget }));
vi.mock("./ui", () => ({
    State: ({ children }: any) => children,
    Modal: ({ children, title }: any) => (
        <div role="dialog">
            <h2>{title}</h2>
            {children}
        </div>
    ),
    useData: () => ({
        data: mocks.state,
        reload: vi.fn(),
        error: "",
        loading: false,
    }),
}));
vi.mock("./i18n", () => ({ tx: (key: string) => key }));
vi.mock("./mfa-api", () => ({
    mfaState: () => "state",
    mfaStart: () => "start",
    mfaFinish: () => "finish",
    sendMfaEmail: vi.fn(),
}));
import { MfaSecurity } from "./MfaSecurity";
import { MfaRecoveryProvider } from "./MfaRecovery";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.state = {
        enrollmentEnabled: true,
        emailEnabled: false,
        totpEnabled: false,
        recoveryCodesRemaining: 0,
    };
});
it("defaults off and does not begin enrollment on page load", () => {
    render(
        <MfaRecoveryProvider>
            <MfaSecurity />
        </MfaRecoveryProvider>,
    );
    expect(screen.getAllByText("未开启")).toHaveLength(2);
    expect(mocks.request).not.toHaveBeenCalled();
});
it("shows a secret locally without enabling before proof", async () => {
    mocks.request.mockResolvedValue({
        data: {
            challengeId: "fixture",
            emailRequired: false,
            secret: "SETUPKEY",
            otpauthUri: "otpauth://totp/Test?secret=SETUPKEY",
        },
    });
    render(
        <MfaRecoveryProvider>
            <MfaSecurity />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "开启身份验证器" }));
    fireEvent.change(screen.getByLabelText("当前密码"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByLabelText("新动态码")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("设置密钥") as HTMLInputElement).value).toBe(
        "SETUPKEY",
    );
});
it("retains recovery codes until the user confirms they were saved", async () => {
    mocks.request
        .mockResolvedValueOnce({
            data: {
                challengeId: "fixture",
                emailRequired: false,
                secret: "SETUPKEY",
                otpauthUri: "otpauth://totp/Test?secret=SETUPKEY",
            },
        })
        .mockResolvedValueOnce({
            data: { recoveryCodes: ["AAAA-BBBB-CCCC-DDDD"] },
        });
    render(
        <MfaRecoveryProvider>
            <MfaSecurity />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "开启身份验证器" }));
    fireEvent.change(screen.getByLabelText("当前密码"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.change(await screen.findByLabelText("新动态码"), {
        target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认更新安全验证" }));
    expect(await screen.findByText("保存恢复码")).toBeTruthy();
    expect((screen.getByLabelText("恢复码") as HTMLTextAreaElement).value).toBe(
        "AAAA-BBBB-CCCC-DDDD",
    );
    expect(mocks.forget).not.toHaveBeenCalled();
    expect(
        screen
            .getByRole("button", { name: "重新登录" })
            .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("我已安全保存恢复码"));
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));
    expect(mocks.forget).toHaveBeenCalledTimes(1);
});
it("requires an existing authenticator factor when disabling", () => {
    mocks.state = {
        enrollmentEnabled: false,
        emailEnabled: true,
        totpEnabled: true,
        recoveryCodesRemaining: 10,
    };
    render(
        <MfaRecoveryProvider>
            <MfaSecurity />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭邮件验证" }));
    expect(screen.getByLabelText("当前密码")).toBeTruthy();
    expect(screen.getByLabelText("当前动态码")).toBeTruthy();
    expect(screen.queryByLabelText("邮箱验证码")).toBeNull();
});
it("hides MFA when site enrollment is disabled and no factors exist", () => {
    mocks.state.enrollmentEnabled = false;
    const view = render(<MfaRecoveryProvider><MfaSecurity /></MfaRecoveryProvider>);
    expect(view.container.innerHTML).toBe("");
    expect(mocks.request).not.toHaveBeenCalled();
});
it("preserves existing factor management but hides new enrollment when disabled", () => {
    mocks.state.enrollmentEnabled = false;
    mocks.state.totpEnabled = true;
    render(<MfaRecoveryProvider><MfaSecurity /></MfaRecoveryProvider>);
    expect(screen.getByRole("button", {name: "关闭身份验证器"})).toBeTruthy();
    expect(screen.queryByRole("button", {name: "开启邮件验证"})).toBeNull();
});
it("does not clear the form after a failed identity check", async () => {
    mocks.request.mockRejectedValue(new Error("身份验证失败"));
    render(
        <MfaRecoveryProvider>
            <MfaSecurity />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "开启邮件验证" }));
    fireEvent.change(screen.getByLabelText("当前密码"), {
        target: { value: "Testing!2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect((await screen.findByRole("alert")).textContent).toBe("身份验证失败");
    await waitFor(() =>
        expect(
            (screen.getByLabelText("当前密码") as HTMLInputElement).value,
        ).toBe("Testing!2026"),
    );
});
