vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./ux", () => ({ ux: (key: string) => key }));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ forget: vi.fn(), clear: vi.fn() }));
vi.mock("./api", () => ({
    boot: { mode: "user" },
    clearReadCache: mocks.clear,
}));
vi.mock("./browser-session", () => ({ forgetBrowserSession: mocks.forget }));
vi.mock("./i18n", () => ({ tx: (key: string) => key, locale: () => "zh-CN" }));
import { MfaRecoveryProvider, useMfaRecovery } from "./MfaRecovery";
const codes = ["AAAA1111-BBBB2222-CCCC3333-DDDD4444"];
function Complete() {
    const complete = useMfaRecovery();
    return <button onClick={() => complete(codes)}>Complete MFA</button>;
}
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("preserves one-time codes when session expiry replaces the authenticated view", () => {
    const { rerender } = render(
        <MfaRecoveryProvider>
            <Complete />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete MFA" }));
    rerender(
        <MfaRecoveryProvider>
            <h1>Login again</h1>
        </MfaRecoveryProvider>,
    );
    expect((screen.getByLabelText("恢复码") as HTMLTextAreaElement).value).toBe(
        codes[0],
    );
    expect(screen.getByRole("heading", { name: "Login again" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("我已安全保存恢复码"));
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.forget).toHaveBeenCalledTimes(1);
});
it("requires saved-code confirmation before backdrop, Escape or close can dismiss", () => {
    render(
        <MfaRecoveryProvider>
            <Complete />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete MFA" }));
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.forget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("我已安全保存恢复码"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
});
