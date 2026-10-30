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
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import { AnalyticsCollectionSettings } from "./AnalyticsCollectionSettings";
import { Settings } from "./admin-settings";
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
    expect(note.textContent).toContain("UTC+08:00");
    expect(note.textContent).toContain("UTC+00:00");
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
it("retains an unavailable trial plan while saving unrelated site settings", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.endsWith("config/fetch")
        ? { site: { app_name: "Existing", try_out_plan_id: 99 } }
        : path.endsWith("plan/fetch") ? [{ id: 7, name: "Basic" }] : {} }));
    render(<Settings section="site" />);
    const plan = await screen.findByRole("combobox", { name: "注册试用" }) as HTMLSelectElement;
    expect(plan.value).toBe("99");
    expect(plan.selectedOptions[0].textContent).toBe("套餐已删除或不可用 (#99)");
    fireEvent.change(screen.getByRole("textbox", { name: "站点名称" }), { target: { value: "Updated" } });
    fireEvent.submit(plan.closest("form")!);
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/config/save", { app_name: "Updated" }));
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
it("moves browser policies to a separate settings tab without changing saved keys", async () => {
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
    render(<Settings />);
    fireEvent.click(await screen.findByRole("button", { name: "安全与注册" }));
    await screen.findByText("保存");
    expect(screen.queryByText("微信访问策略")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "浏览器访问" }));
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

it("clears the settings dirty state after reverting fields and allows testing or switching without discard prompts", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.endsWith("config/fetch")
        ? { site: {}, email: { email_provider: "smtp", email_host: "smtp.example.test", email_from_address: "admin@example.test" }, safe: {} }
        : {} }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<Settings />);
    try {
        fireEvent.click(await screen.findByRole("button", { name: "邮件发送" }));
        const host = await screen.findByLabelText(/SMTP服务器地址/) as HTMLInputElement;
        const test = screen.getByRole("button", { name: "发送测试邮件" }) as HTMLButtonElement;
        expect(test.disabled).toBe(false);
        fireEvent.change(host, { target: { value: "changed.example.test" } });
        expect(test.disabled).toBe(true);
        expect(screen.getAllByText("有未保存的修改").length).toBeGreaterThan(0);
        fireEvent.change(host, { target: { value: "smtp.example.test" } });
        await waitFor(() => expect(test.disabled).toBe(false));
        expect(screen.queryAllByText("有未保存的修改")).toHaveLength(0);
        fireEvent.click(screen.getByRole("button", { name: "安全与注册" }));
        expect(confirm).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "安全与注册" }).getAttribute("aria-pressed")).toBe("true");
    } finally {
        view.unmount();
        confirm.mockRestore();
    }
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

it("filters settings categories without hiding the current editor", async () => {
    api.request.mockResolvedValue({data: {site: {}, safe: {}}});
    render(<Settings />);
    const search = screen.getByRole("searchbox", {name: "搜索设置分类"});
    fireEvent.change(search, {target: {value: "邮件"}});
    expect(screen.getByRole("button", {name: "邮件发送"})).toBeTruthy();
    expect(screen.queryByRole("button", {name: "安全与注册"})).toBeNull();
    expect(screen.getByRole("heading", {name: "站点设置"})).toBeTruthy();
    fireEvent.change(search, {target: {value: "不存在的分类"}});
    expect(screen.getByText("没有匹配的设置分类")).toBeTruthy();
    fireEvent.change(search, {target: {value: ""}});
    expect(screen.getByRole("button", {name: "安全与注册"})).toBeTruthy();
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
