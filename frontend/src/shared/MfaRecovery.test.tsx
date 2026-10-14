vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./ux", () => ({ ux: (key: string) => key }));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
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

it("copies codes without automatically confirming they were saved", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
        <MfaRecoveryProvider>
            <Complete />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete MFA" }));
    fireEvent.click(screen.getByRole("button", { name: "复制恢复码" }));
    await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(codes.join("\n")),
    );
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(
        (screen.getByRole("button", { name: "重新登录" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
});
it("retains codes and offers manual saving when clipboard access is denied", async () => {
    vi.stubGlobal("navigator", {
        clipboard: {
            writeText: vi.fn().mockRejectedValue(new Error("denied")),
        },
    });
    render(
        <MfaRecoveryProvider>
            <Complete />
        </MfaRecoveryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete MFA" }));
    fireEvent.click(screen.getByRole("button", { name: "复制恢复码" }));
    expect((await screen.findByRole("status")).textContent).toContain(
        "无法复制",
    );
    expect((screen.getByLabelText("恢复码") as HTMLTextAreaElement).value).toBe(
        codes[0],
    );
    expect(mocks.forget).not.toHaveBeenCalled();
});

it("downloads a text backup and still requires saved confirmation", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:local-backup");
    const revokeObjectURL = vi.fn();
    const OriginalURL = URL;
    vi.stubGlobal("URL", class extends OriginalURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("recovery-codes.txt");
            expect(document.body.contains(this)).toBe(true);
        expect(this.href).toBe("blob:local-backup");
    });
    render(<MfaRecoveryProvider><Complete /></MfaRecoveryProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Complete MFA" }));
    fireEvent.click(screen.getByRole("button", { name: "下载恢复码" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect((screen.getByRole("button", { name: "重新登录" }) as HTMLButtonElement).disabled).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-backup");
});
