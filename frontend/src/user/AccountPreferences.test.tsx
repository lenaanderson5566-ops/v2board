// @vitest-environment jsdom
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    act,
    render,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    changeLanguage: vi.fn(),
    request: vi.fn(),
    reload: vi.fn(),
    browserFetch: vi.fn(),
    forgetBrowserSession: vi.fn(),
}));
vi.mock("../shared/browser-session", () => ({ browserFetch: mocks.browserFetch, forgetBrowserSession: mocks.forgetBrowserSession }));
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
import { AccountDeletion } from "./AccountDeletion";
import { AccountPreferences } from "./AccountPreferences";
import { TimeZonePicker } from "../shared/TimeZonePicker";
import { AnalyticsPrivacy } from "./AnalyticsPrivacy";
import { privacyKey, savePrivacyChoice, trackAction } from "./product-analytics";
import { AccountSessions } from "./AccountSessions";
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.clearAllMocks();
});
it("keeps the selected account language when persistence fails", async () => {
    mocks.changeLanguage.mockRejectedValue(new Error("保存失败"));
    render(<AccountPreferences user={{ email: "test@example.com" }} />);
    fireEvent.click(screen.getByRole("button", {name:"界面语言"}));
    fireEvent.click(screen.getByRole("radio", {name:"English"}));
    fireEvent.click(screen.getByRole("button", {name:"确认选择"}));
    await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe("保存失败"),
    );
    expect(mocks.changeLanguage).toHaveBeenCalledWith("en-US");
    expect(screen.getByRole("button", {name:"界面语言"}).textContent).toBe("简体中文");
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
it("searches cities, IANA names and UTC offsets without saving draft changes", () => {
    const change = vi.fn();
    render(<TimeZonePicker selectionPanel label="时区" value="Asia/Shanghai" zones={["Asia/Shanghai", "America/New_York", "Europe/Paris"]} onChange={change} />);
    fireEvent.click(screen.getByRole("button", {name:"时区"}));
    const search = screen.getByRole("searchbox", {name:"搜索时区"});
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, {target:{value:"UTC+8"}});
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", {name:/上海/})).toBeTruthy();
    fireEvent.change(search, {target:{value:"Europe/Paris"}});
    fireEvent.click(screen.getByRole("radio", {name:/Paris/}));
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(search, {target:{value:"no-such-zone"}});
    expect(screen.getByRole("status").textContent).toBe("暂无匹配时区");
    fireEvent.click(screen.getByRole("button", {name:"取消"}));
    expect(change).not.toHaveBeenCalled();
});
it("keeps the original zone after save failure, prevents duplicate saves and permits retry", async () => {
    let rejectSave!: (error: Error) => void;
    mocks.request.mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
    render(<AccountPreferences user={{display_timezone:"Asia/Shanghai"}} />);
    fireEvent.click(screen.getByRole("button", {name:"时间显示时区"}));
    fireEvent.click(screen.getByRole("radio", {name:/^UTC/}));
    fireEvent.click(screen.getByRole("button", {name:"确认选择"}));
    fireEvent.click(screen.getByRole("button", {name:"提交中…"}));
    fireEvent.keyDown(document, {key:"Escape"});
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => rejectSave(new Error("保存失败")));
    expect(screen.getByRole("alert").textContent).toBe("保存失败");
    expect(screen.getByRole("button", {name:"时间显示时区"}).textContent).toContain("上海");
    mocks.request.mockResolvedValueOnce({data:true});
    fireEvent.click(screen.getByRole("button", {name:"确认选择"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", {name:"时间显示时区"}).textContent).toContain("UTC");
    expect(mocks.request).toHaveBeenCalledTimes(2);
});

it("persists the display zone and allows following the device again", async () => {
    mocks.request.mockResolvedValue({ data: true });
    const view = render(
        <AccountPreferences user={{ display_timezone: "Asia/Shanghai" }} />,
    );
    fireEvent.click(screen.getByRole("button", {name:"时间显示时区"}));
    fireEvent.click(screen.getByRole("radio", {name:/^UTC/}));
    fireEvent.click(screen.getByRole("button", {name:"确认选择"}));
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
    fireEvent.click(screen.getByRole("button", {name:"时间显示时区"}));
    fireEvent.click(screen.getByRole("radio", {name:/跟随设备/}));
    fireEvent.click(screen.getByRole("button", {name:"确认选择"}));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/update", {
            display_timezone: null,
        }),
    );
});

function privacyScreen(retentionDays = 30, enabled = true) {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({data:{enabled, retentionDays}}) });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<><AnalyticsPrivacy /><AccountPreferences user={{email:"settings@example.com"}} /></>);
    return { ...view, fetcher };
}
it("only renders an inline settings switch and collects after explicit opt-in", async () => {
    const {container, fetcher} = privacyScreen();
    const toggle = screen.getByRole("switch", {name:"analyticsPrivacy"});
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector(".analytics-privacy")).toBeNull();
    expect(toggle.closest(".settings-row")).not.toBeNull();
    trackAction("download", "subscribe");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    trackAction("download", "subscribe");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    trackAction("download", "subscribe");
    expect(fetcher).toHaveBeenCalledTimes(2);
});
it("revokes collection across tabs without opening a banner", async () => {
    savePrivacyChoice("allow",30);
    const {container} = privacyScreen();
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    act(() => {localStorage.removeItem(privacyKey); window.dispatchEvent(new StorageEvent("storage",{key:privacyKey}));});
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector(".analytics-privacy")).toBeNull();
});
it("requires renewed opt-in for a longer retention period", async () => {
    savePrivacyChoice("allow",7);
    privacyScreen(90);
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(JSON.parse(localStorage.getItem(privacyKey)!).retentionDays).toBe(90);
});
it("keeps collection off when saving fails and allows retry", async () => {
    privacyScreen();
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    const write = vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => {throw new Error("blocked");});
    fireEvent.click(toggle);
    expect(screen.getByRole("status").textContent).toBe("analyticsStorageError");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    write.mockRestore();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
});
it.each(["doNotTrack", "globalPrivacyControl"])("honors browser privacy signal %s", async signal => {
    Object.defineProperty(navigator, signal, {configurable:true, value: signal === "doNotTrack" ? "1" : true});
    try {
        privacyScreen();
        await waitFor(() => expect(screen.getByText("analyticsRetention", {exact:false})).toBeTruthy());
        expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText("analyticsSignal")).toBeTruthy();
    } finally { delete (navigator as unknown as Record<string, unknown>)[signal]; }
});
it("keeps the switch disabled when server collection is disabled", async () => {
    privacyScreen(30,false);
    await waitFor(() => expect(screen.getByText("analyticsRetention", {exact:false})).toBeTruthy());
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
});

it("hides account deletion while the administrator switch is off", async () => {
    mocks.browserFetch.mockResolvedValue({ok:true,status:200,json:async()=>({data:{enabled:false,blockers:[]}})});
    const {container}=render(<AccountDeletion />);
    await waitFor(()=>expect(mocks.browserFetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
});
it("shows deletion blockers and prevents confirmation", async () => {
    mocks.browserFetch.mockResolvedValue({ok:true,status:200,json:async()=>({data:{enabled:true,blockers:["ACCOUNT_FUNDS"]}})});
    render(<AccountDeletion />);
    const button=await screen.findByRole("button",{name:"删除账户"});
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先处理账户余额和佣金。")).toBeTruthy();
});
it("requires password, typed confirmation and acknowledgement, then clears login state", async () => {
    mocks.browserFetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>({data:{enabled:true,blockers:[]}})}).mockResolvedValueOnce({ok:true,status:204});
    render(<AccountDeletion />);
    fireEvent.click(await screen.findByRole("button",{name:"删除账户"}));
    const submit=screen.getByRole("button",{name:"确认删除账户"});
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("当前密码"),{target:{value:"test-password"}});
    fireEvent.change(screen.getByLabelText("输入 DELETE 确认删除"),{target:{value:"DELETE"}});
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submit);
    await screen.findByText("账户已删除。");
    expect(mocks.browserFetch.mock.calls[1][0]).toContain("/api/v10/me");
    expect(mocks.browserFetch.mock.calls[1][1].method).toBe("DELETE");
    expect(JSON.parse(mocks.browserFetch.mock.calls[1][1].body)).toEqual({password:"test-password",confirmation:"DELETE"});
    expect(mocks.forgetBrowserSession).toHaveBeenCalledOnce();
});
it("keeps the account signed in and clears the password after a rejected deletion", async () => {
    mocks.browserFetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>({data:{enabled:true,blockers:[]}})}).mockResolvedValueOnce({ok:false,status:409,json:async()=>({code:"RECENT_LOGIN_REQUIRED"})});
    render(<AccountDeletion />);
    fireEvent.click(await screen.findByRole("button",{name:"删除账户"}));
    fireEvent.change(screen.getByLabelText("当前密码"),{target:{value:"test-password"}});
    fireEvent.change(screen.getByLabelText("输入 DELETE 确认删除"),{target:{value:"DELETE"}});
    fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"确认删除账户"}));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("当前密码") as HTMLInputElement).value).toBe("");
    expect(mocks.forgetBrowserSession).not.toHaveBeenCalled();
});
