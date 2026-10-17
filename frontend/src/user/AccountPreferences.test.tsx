// @vitest-environment jsdom
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    render,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    changeLanguage: vi.fn(),
    request: vi.fn(),
    reload: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./profile-copy", () => ({ p: (key: string) => key }));
vi.mock("../shared/i18n", () => ({
    tx: (key: string) => key,
    locale: () => "zh-CN",
    changeLanguage: mocks.changeLanguage,
    languages: [
        { code: "zh-CN", name: "简体中文" },
        { code: "en-US", name: "English" },
    ],
}));
vi.mock("../shared/api", () => ({
    boot: { timeZones: ["UTC", "Asia/Shanghai"] },
    request: mocks.request,
    date: (value: number) => String(value),
    clearReadCache: vi.fn(),
}));
vi.mock("../shared/ui", () => ({
    useData: () => ({
        data: { "session-a": { ip: "127.0.0.1", ua: "Test", login_at: 123 } },
        reload: mocks.reload,
    }),
    Panel: ({ title, children }: any) => (
        <section>
            <h2>{title}</h2>
            {children}
        </section>
    ),
    State: ({ children }: any) => children,
    Modal: ({ children }: any) => <div role="dialog">{children}</div>,
    Table: ({ data, actions }: any) => (
        <div>
            {data.map((row: any) => (
                <div key={row.id}>
                    {row.ip}
                    {actions(row)}
                </div>
            ))}
        </div>
    ),
}));
import { AccountPreferences } from "./AccountPreferences";
import { AccountSessions } from "./AccountSessions";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("keeps the selected account language when persistence fails", async () => {
    mocks.changeLanguage.mockRejectedValue(new Error("保存失败"));
    render(<AccountPreferences user={{ email: "test@example.com" }} />);
    fireEvent.change(screen.getByLabelText("界面语言"), {
        target: { value: "en-US" },
    });
    await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe("保存失败"),
    );
    expect(mocks.changeLanguage).toHaveBeenCalledWith("en-US");
    expect((screen.getByLabelText("界面语言") as HTMLSelectElement).value).toBe(
        "zh-CN",
    );
    expect(screen.queryByRole("link", { name: "账户安全" })).toBeNull();
    expect(screen.queryByRole("link", { name: "通知设置" })).toBeNull();
});
it("retains session removal on the security screen", async () => {
    mocks.request.mockResolvedValue({ data: true });
    render(<AccountSessions />);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(
        screen.getByRole("dialog").querySelector("button.primary")!,
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenCalledWith("user/removeActiveSession", {
        session_id: "session-a",
    });
});

it("persists the display zone and allows following the device again", async () => {
    mocks.request.mockResolvedValue({ data: true });
    const view = render(
        <AccountPreferences user={{ display_timezone: "Asia/Shanghai" }} />,
    );
    fireEvent.change(screen.getByLabelText("时间显示时区"), {
        target: { value: "UTC" },
    });
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/update", {
            display_timezone: "UTC",
        }),
    );
    await waitFor(() =>
        expect(
            (screen.getByLabelText("时间显示时区") as HTMLSelectElement)
                .disabled,
        ).toBe(false),
    );
    view.rerender(<AccountPreferences user={{ display_timezone: "UTC" }} />);
    fireEvent.change(screen.getByLabelText("时间显示时区"), {
        target: { value: "" },
    });
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/update", {
            display_timezone: null,
        }),
    );
});
