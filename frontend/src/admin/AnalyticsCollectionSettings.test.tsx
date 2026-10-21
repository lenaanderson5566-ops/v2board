// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
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
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(screen.getByText("当前策略：提示后允许访问")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith("test-admin/config/save", {
            browser_policy_wechat: "prompt",
        }),
    );
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
