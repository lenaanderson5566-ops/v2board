// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    language: "zh-CN",
    request: vi.fn(),
    reload: vi.fn(),
    forget: vi.fn(),
    data: {} as Record<string, unknown> | null,
    error: "",
}));
vi.mock("../shared/api", () => ({
    boot: { mode: "user" },
    request: mocks.request,
    date: (value: unknown) => String(value),
    clearReadCache: vi.fn(),
}));
vi.mock("../shared/browser-session", () => ({
    forgetBrowserSession: mocks.forget,
}));
vi.mock("../shared/i18n", async () => ({
    ...(await vi.importActual("../shared/i18n")),
    tx: (value: string) => value,
    locale: () => mocks.language,
}));
vi.mock("../shared/ui", async () => ({
    ...(await vi.importActual("../shared/ui")),
    useData: () => ({
        data: mocks.data,
        reload: mocks.reload,
        loading: false,
        error: mocks.error,
    }),
}));
import { AccountSessions } from "./AccountSessions";
beforeEach(() => {
    vi.clearAllMocks();
    mocks.language = "zh-CN";
    mocks.error = "";
    mocks.request.mockResolvedValue({ data: true });
    mocks.data = {
        current: {
            current: true,
            client_kind: "browser",
            ua: "Windows Chrome/123",
            ip: "192.0.2.***",
            country_code: "US",
            login_at: 1,
        },
        other: {
            current: false,
            client_kind: "native",
            ua: "FastAI/1.0 android",
            ip: "192.0.2.***",
            country_code: null,
            login_at: 2,
        },
    };
});
afterEach(cleanup);
it("marks the current session and confirms before revoking another client", async () => {
    render(<AccountSessions />);
    expect(screen.getByText("当前会话", { exact: false })).toBeTruthy();
    expect(screen.getByText(/FastAI\/1.0/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "退出登录" })[1]);
    expect(mocks.request).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector("button.primary")!);
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenCalledWith("user/removeActiveSession", {
        session_id: "other",
    });
    expect(mocks.forget).not.toHaveBeenCalled();
});
it("clears local authentication when the current session is revoked", async () => {
    render(<AccountSessions />);
    fireEvent.click(screen.getAllByRole("button", { name: "退出登录" })[0]);
    fireEvent.click(
        screen.getByRole("dialog").querySelector("button.primary")!,
    );
    await waitFor(() => expect(mocks.forget).toHaveBeenCalled());
    expect(mocks.reload).not.toHaveBeenCalled();
});
it("keeps the confirmation open and allows retry when revocation fails", async () => {
    mocks.request.mockRejectedValue(new Error("offline"));
    render(<AccountSessions />);
    fireEvent.click(screen.getAllByRole("button", { name: "退出登录" })[1]);
    fireEvent.click(
        screen.getByRole("dialog").querySelector("button.primary")!,
    );
    await waitFor(() =>
        expect(screen.getByRole("dialog").textContent).toContain("offline"),
    );
    expect(mocks.forget).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
});
it("retries a failed session list in place and restores session controls", () => {
    const loaded = mocks.data;
    mocks.data = null;
    mocks.error = "sessions temporarily unavailable";
    const view = render(<AccountSessions />);
    expect(screen.getByRole("alert").textContent).toContain(mocks.error);
    expect((screen.getByRole("button", { name: "退出全部会话" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    mocks.data = loaded;
    mocks.error = "";
    view.rerender(<AccountSessions />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("button", { name: "退出登录" })).toHaveLength(2);
    expect((screen.getByRole("button", { name: "退出全部会话" }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([
    ["zh-CN", "美国"],
    ["en-US", "United States"],
])(
    "shows localized locations in %s with masked IPs and accessible exit icons",
    (language, country) => {
        mocks.language = language;
        render(<AccountSessions />);
        expect(screen.getByText(country)).toBeTruthy();
        expect(screen.getByText("位置未知")).toBeTruthy();
        expect(screen.getAllByText("192.0.2.***")).toHaveLength(2);
        expect(screen.getByText("1")).toBeTruthy();
        expect(screen.getByText("2")).toBeTruthy();
        for (const button of screen.getAllByRole("button", {
            name: "退出登录",
        })) {
            expect(button.querySelector("svg")).toBeTruthy();
            expect(button.getAttribute("title")).toBe("退出登录");
        }
    },
);
