// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import { AnalyticsCollectionSettings } from "./AnalyticsCollectionSettings";
import { Settings } from "./admin-settings";
import { adminEditorField } from "./admin-editor-fields";
import { TargetStatisticsSettings, AdminTargetStatistics } from "./AdminTargetStatistics";
import * as sharedUI from "../shared/ui";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("requires explicit review before changing the business time zone and saves only the existing changed setting", async () => {
    api.request.mockImplementation(async (path: string) => ({data:path.endsWith("config/fetch") ? {site:{system_timezone:"Asia/Shanghai",app_name:"Timezone review"}} : path.endsWith("plan/fetch") ? [] : {}}));
    render(<Settings section="site"/>);
    const zone=await screen.findByRole("combobox",{name:"系统业务时区"});
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.change(zone,{target:{value:"UTC"}});
    const note=screen.getByRole("note");
    expect(note.textContent).toContain("Asia/Shanghai");
    expect(note.textContent).toContain("UTC+8");
    expect(note.textContent).toContain("UTC");
    const confirm=screen.getByRole("checkbox",{name:/Asia\/Shanghai.*UTC/}) as HTMLInputElement;
    expect(confirm.checked).toBe(false);
    expect(confirm.required).toBe(true);
    fireEvent.submit(zone.closest("form")!);
    await screen.findByRole("alert");
    expect(api.request.mock.calls.some(([path])=>path==="test-admin/config/save")).toBe(false);
    fireEvent.click(confirm);
    // Saving a changed system zone deliberately reloads the application; keep this
    // component test on the page while verifying the unchanged request contract.
    const timeout=vi.spyOn(window,"setTimeout").mockReturnValue(0 as unknown as ReturnType<typeof window.setTimeout>);
    try {
        fireEvent.submit(zone.closest("form")!);
        fireEvent.submit(zone.closest("form")!);
        expect(api.request).toHaveBeenCalledWith("test-admin/config/save",{system_timezone:"UTC"});
        expect(api.request.mock.calls.filter(([path])=>path==="test-admin/config/save")).toHaveLength(1);
        await act(async()=>{});
    } finally {timeout.mockRestore();}
});
it("clears the time zone review on revert and requires a new review after changing the choice again", async () => {
    api.request.mockImplementation(async (path: string) => ({data:path.endsWith("config/fetch") ? {site:{system_timezone:"Asia/Shanghai",app_name:"Timezone review"}} : path.endsWith("plan/fetch") ? [] : {}}));
    render(<Settings section="site"/>);
    const zone=await screen.findByRole("combobox",{name:"系统业务时区"});
    fireEvent.change(zone,{target:{value:"UTC"}});
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox",{name:"站点名称"}),{target:{value:"Another site name"}});
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(zone,{target:{value:"Asia/Shanghai"}});
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(zone,{target:{value:"UTC"}});
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(api.request.mock.calls.some(([path])=>path==="test-admin/config/save")).toBe(false);
});
it("retains an unavailable trial plan and paused registration while saving another registration setting", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.endsWith("config/fetch")
        ? { site: { stop_register: 1, try_out_plan_id: 99, tos_url: "https://example.test/terms" }, invite: { invite_force: 1 } }
        : path.endsWith("plan/fetch") ? [{ id: 7, name: "Basic" }] : {} }));
    render(<Settings section="registration" />);
    const plan = await screen.findByRole("combobox", { name: "试用套餐" }) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Basic" });
    expect(plan.value).toBe("99");
    expect(plan.selectedOptions[0].textContent).toBe("套餐已删除或不可用 (#99)");
    expect(screen.getByRole("combobox", { name: "注册方式" })).toHaveProperty("value", "paused");
    fireEvent.change(screen.getByLabelText("服务条款网址"), { target: { value: "https://example.test/new-terms" } });
    fireEvent.submit(plan.closest("form")!);
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/config/save", { tos_url: "https://example.test/new-terms" }));
});

it.each([
    [0, 1, "仅限邮件邀请", "暂停注册", { stop_register: 1 }],
    [1, 1, "暂停注册", "公开注册", { stop_register: 0, invite_force: 0 }],
    [1, 0, "暂停注册", "仅限邮件邀请", { stop_register: 0, invite_force: 1 }],
])("saves the selected registration mode from %s / %s without sending synthetic fields", async (stop, invite, initial, next, expected) => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("plan/fetch")) throw new Error("Plan directory offline");
        return { data: path.endsWith("config/fetch") ? {
            site: { stop_register: stop },
            invite: { invite_force: invite, invite_gen_limit: 0 },
            safe: { email_verify: 1 },
        } : {} };
    });
    render(<sharedUI.EditorFieldContext.Provider value={adminEditorField}>
        <Settings section="registration" />
    </sharedUI.EditorFieldContext.Provider>);
    expect((await screen.findByRole("button", { name: initial })).getAttribute("aria-pressed")).toBe("true");
    const option = screen.getByRole("button", { name: next });
    fireEvent.click(option);
    expect(option.getAttribute("aria-pressed")).toBe("true");
    expect(Boolean(screen.queryByText(/发送上限为 0 时无法发出新邀请/))).toBe(next === "仅限邮件邀请");
    expect(screen.getByText(/试用套餐列表加载失败，仍可保存其他注册设置/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path]) => path.endsWith("config/save"))).toBe(false);
    fireEvent.submit(option.closest("form")!);
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/config/save", expected));
    expect(api.request.mock.calls.filter(([path]) => path.endsWith("config/save"))).toHaveLength(1);
});

it("keeps subscription addresses and timed link settings together with a flat save", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.endsWith("config/fetch") ? {
        site: { subscribe_url: "https://subscriptions.example.test", subscribe_path: "/custom" },
        subscribe: { show_subscribe_method: 2, show_subscribe_expire: 5 },
    } : path.endsWith("server/group/fetch") ? [] : {} }));
    render(<Settings section="subscribe" />);
    const address = await screen.findByLabelText("订阅域名");
    expect(address).toHaveProperty("value", "https://subscriptions.example.test");
    expect(screen.getByLabelText("限时订阅链接有效时间（分钟）")).toHaveProperty("value", "5");
    fireEvent.change(address, { target: { value: "https://new.example.test" } });
    fireEvent.submit(address.closest("form")!);
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/config/save", { subscribe_url: "https://new.example.test" }));
});

it("keeps ordinary settings saves free of a time zone confirmation",async()=>{
    api.request.mockImplementation(async(path:string)=>({data:path.endsWith("config/fetch") ? {site:{system_timezone:"Asia/Shanghai",app_name:"Existing"}} : path.endsWith("plan/fetch") ? [] : {}}));
    render(<Settings section="site"/>);
    const name=await screen.findByRole("textbox",{name:"站点名称"});
    fireEvent.change(name,{target:{value:"Updated"}});
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.submit(name.closest("form")!);
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/config/save",{app_name:"Updated"}));
});
it("does not save a reviewed time zone change while its configuration refresh has failed",async()=>{
    let error="";
    const useData=vi.spyOn(sharedUI,"useData").mockImplementation(((path:string)=>({data:path.endsWith("config/fetch") ? {site:{system_timezone:"Asia/Shanghai"}} : path.endsWith("plan/fetch") ? [] : {},loading:false,error,reload:vi.fn(),retryAt:0})) as any);
    const view=render(<Settings section="site"/>);
    try {
        const zone=await screen.findByRole("combobox",{name:"系统业务时区"});
        fireEvent.change(zone,{target:{value:"UTC"}});
        fireEvent.click(screen.getByRole("checkbox"));
        error="Configuration refresh unavailable";
        view.rerender(<Settings section="site"/>);
        expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
        fireEvent.submit(zone.closest("form")!);
        await act(async()=>{});
        expect(api.request.mock.calls.some(([path])=>path==="test-admin/config/save")).toBe(false);
    } finally {view.unmount();useData.mockRestore();}
});
it("keeps target collection off until the administrator enables its independent switch", async () => {
    api.request.mockImplementation(async (_path,body)=>({data:body ? {enabled:body.enabled} : {settings:{enabled:false},nodes:[],rows:[],total:0}}));
    render(<TargetStatisticsSettings />);
    const toggle=await screen.findByRole("switch",{name:"统计用户访问的域名和 IP"});
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(()=>expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(api.request).toHaveBeenCalledWith("test-admin/target-statistics/settings",{enabled:true});
    fireEvent.click(toggle);
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/target-statistics/settings",{enabled:false}));
});
it("keeps target collection unchanged when saving fails", async () => {
    api.request.mockImplementation(async (_path,body)=>{
        if(body)throw new Error("保存失败");
        return {data:{settings:{enabled:false}}};
    });
    render(<TargetStatisticsSettings />);
    const toggle=await screen.findByRole("switch");
    fireEvent.click(toggle);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
});
it("shows domain and IP target aggregates and filters by node", async () => {
    api.request.mockResolvedValue({data:{settings:{enabled:true},nodes:[{id:7,name:"节点 7",supported:true}],rows:[{userId:1,type:"domain",target:"example.com",connections:2,uploadBytes:100,downloadBytes:200},{userId:1,type:"ip",target:"2001:db8::1",connections:1,uploadBytes:10,downloadBytes:20}],total:2,dropped:0}});
    render(<AdminTargetStatistics />);
    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.getByText("2001:db8::1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("访问目标节点"),{target:{value:"7"}});
    await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("nodeId=7"))).toBe(true));
});
it("reads and saves collection settings through the dedicated configuration endpoint", async () => {
    api.request.mockResolvedValue({
        data: { ready: true, settings: { enabled: false, retentionDays: 30 } },
    });
    render(<AnalyticsCollectionSettings />);
    fireEvent.click(await screen.findByLabelText("开启访问统计"));
    fireEvent.change(screen.getByLabelText("保留时间"), {
        target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/analytics/settings",
            { enabled: true, retentionDays: 7 },
        ),
    );
    expect(
        api.request.mock.calls.every(
            ([path]) => path === "test-admin/analytics/settings",
        ),
    ).toBe(true);
});
it("disables collection edits before migrations and exposes read failures", async () => {
    api.request.mockResolvedValue({
        data: { ready: false, settings: { enabled: false, retentionDays: 30 } },
    });
    const view = render(<AnalyticsCollectionSettings />);
    expect(
        ((await screen.findByLabelText("开启访问统计")) as HTMLInputElement)
            .disabled,
    ).toBe(true);
    view.unmount();
    api.request.mockRejectedValue(new Error("读取失败"));
    render(<AnalyticsCollectionSettings />);
    expect(await screen.findByText("读取失败")).toBeTruthy();
});
it("keeps browser policies in their own settings section and saves the same keys", async () => {
    api.request.mockImplementation(async (path: string) => ({
        data: path.endsWith("config/fetch")
            ? {
                  site: {},
                  safe: {
                      browser_policy_wechat: "guide",
                      register_limit_by_ip_enable: 0,
                  },
              }
            : {},
    }));
    const account = render(<Settings section="safe" />);
    await screen.findByRole("button", { name: "保存" });
    expect(screen.queryByLabelText(/微信访问策略/)).toBeNull();
    account.unmount();
    render(<Settings section="browser" />);
    const policy = await screen.findByLabelText(/微信访问策略/);
    fireEvent.change(policy, { target: { value: "prompt" } });
    expect(screen.getByText("微信 · 提示后允许访问")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith("test-admin/config/save", {
            browser_policy_wechat: "prompt",
        }),
    );
});

it("retains unsaved settings and their editing baseline through loading, failure and new snapshots", async () => {
    let snapshot: any = { safe: { browser_policy_wechat: "guide" } };
    let loading = false, error = "";
    const reload = vi.fn();
    const useData = vi.spyOn(sharedUI, "useData").mockImplementation(((path: string) => ({
        data: path.endsWith("config/fetch") ? snapshot : path.endsWith("configSchema") ? {} : null,
        loading, error, reload, retryAt: 0,
    })) as any);
    api.request.mockResolvedValue({ data: true });
    const view = render(<Settings section="browser" />);
    try {
        const policy = await screen.findByLabelText(/微信访问策略/) as HTMLSelectElement;
        fireEvent.change(policy, { target: { value: "prompt" } });
        loading = true;
        snapshot = null;
        view.rerender(<Settings section="browser" />);
        expect(screen.getByLabelText(/微信访问策略/)).toBe(policy);
        expect(policy.value).toBe("prompt");
        loading = false; error = "临时读取失败";
        view.rerender(<Settings section="browser" />);
        expect(screen.getByLabelText(/微信访问策略/)).toBe(policy);
        expect(policy.value).toBe("prompt");
        error = "";
        snapshot = { safe: { browser_policy_wechat: "block" } };
        view.rerender(<Settings section="browser" />);
        expect(policy.value).toBe("prompt");
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/config/save", { browser_policy_wechat: "prompt" }));
    } finally {
        view.unmount();
        useData.mockRestore();
    }
});

it("clears the navigation guard and enables mail testing after reverting an edit", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.endsWith("config/fetch")
        ? { site: {}, email: { email_provider: "smtp", email_host: "smtp.example.test", email_from_address: "admin@example.test" }, safe: {} }
        : {} }));
    render(<Settings section="email" />);
    const host = await screen.findByLabelText(/SMTP服务器地址/) as HTMLInputElement;
    const test = screen.getByRole("button", { name: "发送测试邮件" }) as HTMLButtonElement;
    expect(test.disabled).toBe(false);
    fireEvent.change(host, { target: { value: "changed.example.test" } });
    expect(test.disabled).toBe(true);
    expect(host.closest("form")?.getAttribute("data-unsaved")).toBe("true");
    fireEvent.change(host, { target: { value: "smtp.example.test" } });
    await waitFor(() => expect(test.disabled).toBe(false));
    expect(host.closest("form")?.hasAttribute("data-unsaved")).toBe(false);
    fireEvent.click(test);
    await screen.findByText(/邮件已被发送服务接受/);
    expect(api.request).toHaveBeenCalledWith("test-admin/config/testSendMail", {});
});

it("shows missing mail setup beside the disabled test action", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.endsWith("config/fetch")
        ? { email: { email_provider: "smtp", email_from_address: "admin@example.test" } }
        : {} }));
    render(<Settings section="email" />);
    expect(await screen.findByRole("button", { name: "发送测试邮件" })).toHaveProperty("disabled", true);
    expect(screen.getByText("请先填写并保存 SMTP 服务器地址。")).toBeTruthy();
    expect(screen.getByText("请先启用并保存推广独立通道。")).toBeTruthy();
});

it("keeps transactional success and promotional failure as separate test results", async () => {
    api.request.mockImplementation(async (path: string, body?: { stream?: string }) => {
        if (path.endsWith("config/fetch")) return { data: { email: {
            email_provider: "smtp", email_host: "smtp.example.test", email_from_address: "admin@example.test",
            email_announcement_separate: true, email_announcement_provider: "smtp",
            email_announcement_host: "promo.example.test", email_announcement_from_address: "promo@example.test",
        } } };
        if (path.endsWith("testSendMail")) return body?.stream === "announcement"
            ? { data: false, log: { error: "推广发送失败" } }
            : { data: true };
        return { data: {} };
    });
    render(<Settings section="email" />);
    fireEvent.click(await screen.findByRole("button", { name: "发送测试邮件" }));
    const accepted = await screen.findByText(/邮件已被发送服务接受/);
    expect(accepted.closest('[role="status"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "测试推广通道（发往管理员）" }));
    const rejected = await screen.findByText("推广发送失败");
    expect(rejected.closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByText(/邮件已被发送服务接受/)).toBe(accepted);
});

it("applies target user filters only on submit and keeps shared pagination", async () => {
 api.request.mockResolvedValue({data:{settings:{enabled:true},nodes:[{id:7,name:"节点 7",supported:true}],rows:[{userId:123,type:"domain",target:"example.com",connections:1}],total:26,dropped:0}});
 render(<AdminTargetStatistics />);
 await screen.findByText("example.com");
 fireEvent.change(screen.getByLabelText("访问目标节点"),{target:{value:"7"}});
 await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("nodeId=7"))).toBe(true));
 await waitFor(()=>expect((screen.getByRole("button",{name:"查询"}) as HTMLButtonElement).disabled).toBe(false));
 api.request.mockClear();
 fireEvent.change(screen.getByLabelText("访问目标用户 ID"),{target:{value:"123"}});
 expect(api.request).not.toHaveBeenCalled();
 fireEvent.submit(screen.getByRole("form",{name:"访问目标筛选"}));
 await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("userId=123") && path.includes("page=1"))).toBe(true));
 await waitFor(()=>expect((screen.getByRole("button",{name:"下一页"}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button",{name:"下一页"}));
 await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("userId=123") && path.includes("nodeId=7") && path.includes("page=2"))).toBe(true));
 await waitFor(()=>expect((screen.getByRole("button",{name:"重置"}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button",{name:"重置"}));
 await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("userId=0") && path.includes("nodeId=0") && path.includes("page=1"))).toBe(true));
 expect((screen.getByLabelText("访问目标用户 ID") as HTMLInputElement).value).toBe("");
});

it("shows bounded cache usage and rejected target batches", async () => {
    api.request.mockResolvedValue({data:{settings:{enabled:true},nodes:[],rows:[],total:0,dropped:0,
        usage:{usedBytes:1048576,budgetBytes:67108864,receivedBytes:2048,rejectedBatches:3}}});
    render(<AdminTargetStatistics />);
    expect(await screen.findByText(/缓存预算/)).toBeTruthy();
    expect(screen.getByText(/容量拒收 3 批/)).toBeTruthy();
});

it("saves target cadence independently of collection and defaults older settings to one minute", async () => {
    let seconds=60;
    api.request.mockImplementation(async (_path,body)=> {
        if(body?.reportIntervalSeconds) {seconds=body.reportIntervalSeconds;return {data:{enabled:false,reportIntervalSeconds:seconds}};}
        return {data:{settings:{enabled:false,reportIntervalSeconds:seconds}}};
    });
    render(<TargetStatisticsSettings />);
    const select=await screen.findByRole("combobox",{name:"统计上报周期"});
    expect((select as HTMLSelectElement).value).toBe("60");
    fireEvent.change(select,{target:{value:"300"}});
    await waitFor(()=>expect((select as HTMLSelectElement).value).toBe("300"));
    expect(api.request).toHaveBeenCalledWith("test-admin/target-statistics/settings",{reportIntervalSeconds:300});
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});
it("preserves cadence on failed save and allows retry", async () => {
    api.request.mockImplementation(async (_path,body)=> {
        if(body) throw new Error("周期保存失败");
        return {data:{settings:{enabled:true,reportIntervalSeconds:120}}};
    });
    render(<TargetStatisticsSettings />);
    const select=await screen.findByRole("combobox",{name:"统计上报周期"});
    fireEvent.change(select,{target:{value:"300"}});
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","周期保存失败");
    expect((select as HTMLSelectElement).value).toBe("120");
    expect((select as HTMLSelectElement).disabled).toBe(false);
});

it("distinguishes fixed cadence nodes from nodes supporting the setting", async () => {
    api.request.mockResolvedValue({data:{settings:{enabled:true},rows:[],total:0,nodes:[
        {id:1,name:"旧节点",supported:true,configurableInterval:false},
        {id:2,name:"新节点",supported:true,configurableInterval:true}
    ]}});
    render(<AdminTargetStatistics />);
    expect(await screen.findByRole("option",{name:"旧节点（周期固定）"})).toBeTruthy();
    expect(screen.getByRole("option",{name:"新节点"})).toBeTruthy();
});

it("saves target retention independently and confirms shortening", async () => {
    api.request.mockImplementation(async (_path,body)=>({data:body ? {retentionHours:body.retentionHours} : {settings:{enabled:false,retentionHours:6}}}));
    render(<TargetStatisticsSettings/>);
    const field=await screen.findByLabelText("访问目标保留时间");
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    try {
        fireEvent.change(field,{target:{value:"1"}});
        expect((field as HTMLSelectElement).value).toBe("6");
        expect(api.request.mock.calls.some(([,body])=>body)).toBe(false);
        fireEvent.change(field,{target:{value:"24"}});
        await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/target-statistics/settings",{retentionHours:24}));
    } finally {confirm.mockRestore();}
});

it("saves daily retention independently and preserves prior value after failure", async()=>{
    api.request.mockImplementation(async (_path,body)=>{if(body)throw new Error("日汇总保存失败");return {data:{settings:{enabled:true,dailyRetentionDays:7,retentionHours:6}}};});
    render(<TargetStatisticsSettings/>);
    const field=await screen.findByLabelText("节点日汇总保留时间");
    fireEvent.change(field,{target:{value:"30"}});
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","日汇总保存失败");
    expect((field as HTMLSelectElement).value).toBe("7");
    expect(api.request).toHaveBeenCalledWith("test-admin/target-statistics/settings",{dailyRetentionDays:30});
});
it("daily view resets pagination and excludes user filters",async()=>{
    api.request.mockResolvedValue({data:{settings:{enabled:true,dailyRetentionDays:30},nodes:[],rows:[],total:0,dailyReady:true,dailyUsedRows:0,dailyMaxRows:200000}});
    render(<AdminTargetStatistics/>);
    await screen.findByText("请选择节点查看统计。");
    fireEvent.change(screen.getByLabelText("访问目标用户 ID"),{target:{value:"123"}});
    fireEvent.submit(screen.getByRole("form",{name:"访问目标筛选"}));
    fireEvent.click(screen.getByRole("button",{name:"节点日汇总"}));
    await waitFor(()=>expect(api.request.mock.calls.some(([p])=>p.includes("view=daily")&&p.includes("userId=0")&&p.includes("page=1"))).toBe(true));
    expect((screen.getByLabelText("访问目标用户 ID") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("columnheader",{name:"日期（UTC）"})).toBeTruthy();
    expect(screen.queryByRole("columnheader",{name:"用户 ID"})).toBeNull();
});

it("prevents retention expansion while background expiry cleanup is pending",async()=>{
    api.request.mockResolvedValue({data:{settings:{enabled:true,dailyRetentionDays:7,dailyCleanupPending:true}}});
    render(<TargetStatisticsSettings/>);
    const field=await screen.findByLabelText("节点日汇总保留时间");
    expect((field as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole("button",{name:"检查清理进度"})).toBeTruthy();
});
