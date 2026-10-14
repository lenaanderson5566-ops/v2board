// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), send: vi.fn() }));
vi.mock("./api", () => ({ request: mocks.request }));
vi.mock("./i18n", () => ({ tx: (key: string) => key }));
vi.mock("./mfa-api", () => ({
    mfaFinish: () => "passport/mfa/verifications",
    sendMfaEmail: mocks.send,
}));
import { MfaLogin } from "./MfaLogin";
const challenge = {
    mfaRequired: true as const,
    challengeId: "a".repeat(64),
    preferredMethod: "totp" as const,
    methods: ["totp", "email", "recovery"] as ("totp" | "email" | "recovery")[],
    expiresAt: "2030-01-01T00:00:00Z",
};
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("prefers TOTP and does not send email automatically", () => {
    render(
        <MfaLogin
            challenge={challenge}
            onComplete={vi.fn()}
            onCancel={vi.fn()}
        />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "totp",
    );
    expect(mocks.send).not.toHaveBeenCalled();
});
it("completes verification once under rapid clicks", async () => {
    let done: (value: any) => void = () => {};
    mocks.request.mockImplementation(
        () =>
            new Promise((resolve) => {
                done = resolve;
            }),
    );
    const complete = vi.fn().mockResolvedValue(undefined);
    render(
        <MfaLogin
            challenge={challenge}
            onComplete={complete}
            onCancel={vi.fn()}
        />,
    );
    fireEvent.change(screen.getByLabelText("验证码"), {
        target: { value: "123456" },
    });
    const button = screen.getByRole("button", { name: "验证并登录" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    done({ data: { authenticated: true } });
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(mocks.request).toHaveBeenCalledWith("passport/mfa/verifications", {
        challengeId: challenge.challengeId,
        verificationMethod: "totp",
        verificationCode: "123456",
    });
});
it("keeps an invalid challenge available for retry without signing in", async () => {
    mocks.request.mockRejectedValue(new Error("验证码错误"));
    const complete = vi.fn();
    render(
        <MfaLogin
            challenge={challenge}
            onComplete={complete}
            onCancel={vi.fn()}
        />,
    );
    fireEvent.change(screen.getByLabelText("验证码"), {
        target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));
    expect((await screen.findByRole("alert")).textContent).toBe("验证码错误");
    expect(complete).not.toHaveBeenCalled();
});
it("only sends email after the enabled email method is chosen", async () => {
    mocks.send.mockResolvedValue(undefined);
    render(
        <MfaLogin
            challenge={challenge}
            onComplete={vi.fn()}
            onCancel={vi.fn()}
        />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    await waitFor(() =>
        expect(mocks.send).toHaveBeenCalledWith(challenge.challengeId),
    );
    expect(screen.getByRole("status").textContent).toContain("60秒");
});
it("clears a code when switching to recovery and allows cancellation", () => {
    const cancel = vi.fn();
    render(
        <MfaLogin
            challenge={challenge}
            onComplete={vi.fn()}
            onCancel={cancel}
        />,
    );
    fireEvent.change(screen.getByLabelText("验证码"), {
        target: { value: "123456" },
    });
    fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "recovery" },
    });
    expect((screen.getByLabelText("恢复码") as HTMLInputElement).value).toBe(
        "",
    );
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(cancel).toHaveBeenCalledTimes(1);
});

it("retries loading the account without replaying an already verified challenge", async () => {
    mocks.request.mockResolvedValue({ data: { authenticated: true } });
    const complete = vi
        .fn()
        .mockRejectedValueOnce(new Error("网络中断"))
        .mockResolvedValueOnce(undefined);
    render(
        <MfaLogin
            challenge={challenge}
            onComplete={complete}
            onCancel={vi.fn()}
        />,
    );
    fireEvent.change(screen.getByLabelText("验证码"), {
        target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));
    expect((await screen.findByRole("alert")).textContent).toBe("网络中断");
    fireEvent.click(screen.getByRole("button", { name: "重试进入账户" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
