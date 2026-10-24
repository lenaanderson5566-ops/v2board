// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
const api=vi.hoisted(()=>{window.V2BOARD={mode:"admin",adminPath:"test-admin"} as any;return {request:vi.fn()};});
vi.mock("../shared/api",async original=>({...await original<typeof import("../shared/api")>(),request:api.request,readRequest:api.request}));
import {ServerTrafficBudgets} from "./ServerTrafficBudgets";
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
it("raises a shared quota without resetting usage or exposing child bindings",async()=>{
 api.request.mockImplementation(async(path:string)=>path.endsWith("/fetch")?{data:[{id:1,name:"Server A",limitBytes:1073741824,usedBytes:1073741824,blocked:true,countingMode:"both",resetDay:1,nodes:[{type:"v2box",id:7}],thisMonth:{uploadBytes:1,downloadBytes:2},last30Days:{uploadBytes:1,downloadBytes:2}}]}:{data:{id:1}});
 render(<ServerTrafficBudgets nodes={[{type:"v2box",id:7,name:"Root"},{type:"v2box",id:8,name:"Child",service_id:7}]} close={()=>{}} onSaved={()=>{}}/>);
 expect(await screen.findByText("已限制")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"修改"}));
 expect(screen.queryByText(/Child/)).toBeNull();
 fireEvent.change(screen.getByLabelText(/流量限额/),{target:{value:"2"}});fireEvent.click(screen.getByRole("button",{name:"保存额度"}));
 await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/traffic-budget/save",expect.objectContaining({id:1,limitBytes:2147483648,nodes:[{type:"v2box",id:7}]})));
});

import {NetworkServers} from "./NetworkServers";
import {trafficPayload} from "./ServerTrafficFields";
const machine={id:7,name:"Physical machine",family:"ipv4",enabled:true};
const quota={id:1,networkServerId:7,name:"Physical machine",limitBytes:1073741824,usedBytes:1073741824,blocked:true,countingMode:"both",resetDay:1,periodStart:"2026-10-01T00:00:00Z",periodEnd:"2026-11-01T00:00:00Z",nodes:[{type:"v2box",id:7}]};
function integrated(){api.request.mockImplementation(async(path:string)=>String(path).includes("network/traffic?")?{data:{budget:quota,nodes:quota.nodes,history:[{dayAt:1792800000,uploadBytes:10,downloadBytes:20}]}}:String(path).includes("traffic-budget/fetch")?{data:[quota]}:{data:{id:7}});}
it("saves server metadata and quota together without resetting or manually selecting nodes",async()=>{
 integrated();render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={()=>{}}/>);
 await screen.findByText("已达额度");fireEvent.click(screen.getByRole("button",{name:"管理"}));
 expect(screen.queryByText("服务器上的节点")).toBeNull();
 fireEvent.change(screen.getByLabelText(/流量额度（/),{target:{value:"2"}});
 fireEvent.click(screen.getByRole("button",{name:"保存服务器配置"}));
 await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/network/save",{id:7,name:"Physical machine",family:"ipv4",enabled:true,traffic:{limitBytes:2147483648,countingMode:"both",resetDay:1}}));
 expect(api.request.mock.calls.some(([path])=>String(path).endsWith("traffic-budget/save"))).toBe(false);
});
it("loads bounded traffic history only when server details open",async()=>{
 integrated();render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={()=>{}}/>);
 await screen.findByText("已达额度");expect(api.request.mock.calls.some(([path])=>String(path).includes("network/traffic?"))).toBe(false);
 fireEvent.click(screen.getByRole("button",{name:"管理"}));
 expect(await screen.findByText("每日用量（最近 90 天）")).toBeTruthy();
 expect(api.request.mock.calls.some(([path])=>path==="test-admin/server/network/traffic?id=7")).toBe(true);
});
it("keeps the edit open and does not send a rejected cycle change",async()=>{
 integrated();vi.spyOn(window,"confirm").mockReturnValue(false);
 render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={()=>{}}/>);
 await screen.findByText("已达额度");fireEvent.click(screen.getByRole("button",{name:"管理"}));
 fireEvent.change(screen.getByLabelText("每月周期起始日"),{target:{value:"15"}});fireEvent.click(screen.getByRole("button",{name:"保存服务器配置"}));
 await waitFor(()=>expect(window.confirm).toHaveBeenCalled());expect(screen.getByLabelText("每月周期起始日")).toHaveProperty("value","15");
 expect(api.request.mock.calls.some(([path])=>String(path).endsWith("network/save"))).toBe(false);vi.restoreAllMocks();
});
it("rejects invalid quota values before sending a request",()=>{
 for(const trafficGiB of ["", "NaN", "Infinity", "-1", "9007199254740991"])expect(()=>trafficPayload({trafficGiB,countingMode:"both",resetDay:1})).toThrow();
 expect(trafficPayload({trafficGiB:"0",countingMode:"both",resetDay:1}).limitBytes).toBe(0);
});

it("retains an unambiguous legacy quota when opening the integrated editor",async()=>{
 api.request.mockResolvedValue({data:[{...quota,networkServerId:null}]});
 render(<NetworkServers data={{servers:[machine],assignments:[{server_id:7,node_type:"v2box",node_id:7}],credentials:[]}} reload={()=>{}}/>);
 await screen.findByText("已达额度");fireEvent.click(screen.getByRole("button",{name:"管理"}));
 expect(screen.getByLabelText(/流量额度（/)).toHaveProperty("value","1");
});

it("offers only management and keeps the same drawer open after saving",async()=>{
 integrated();render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={()=>{}}/>);
 await screen.findByText("已达额度");expect(screen.queryByRole("button",{name:"编辑"})).toBeNull();expect(screen.queryByRole("button",{name:"详情"})).toBeNull();expect(screen.queryByRole("button",{name:"删除服务器"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:machine.name}));
 expect(screen.getAllByRole("dialog")).toHaveLength(1);expect(screen.getByRole("button",{name:"添加入口域名"})).toBeTruthy();
 fireEvent.change(screen.getByLabelText("服务器名称"),{target:{value:"Renamed machine"}});fireEvent.click(screen.getByRole("button",{name:"保存服务器配置"}));
 await waitFor(()=>expect(api.request.mock.calls.some(([path])=>String(path).endsWith("network/save"))).toBe(true));
 expect(screen.getAllByRole("dialog")).toHaveLength(1);expect(screen.getByLabelText("服务器名称")).toHaveProperty("value","Renamed machine");
});
it("guards unsaved server changes on close and before entering forwarding",async()=>{
 integrated();vi.spyOn(window,"confirm").mockReturnValue(false);render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={()=>{}}/>);
 await screen.findByText("已达额度");fireEvent.click(screen.getByRole("button",{name:"管理"}));fireEvent.change(screen.getByLabelText("服务器名称"),{target:{value:"Unsaved"}});
 expect((screen.getByRole("button",{name:"添加入口域名"}) as HTMLButtonElement).closest("fieldset")?.disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"关闭"}));expect(window.confirm).toHaveBeenCalled();expect(screen.getByLabelText("服务器名称")).toHaveProperty("value","Unsaved");
 expect(api.request.mock.calls.some(([path])=>String(path).endsWith("network/save"))).toBe(false);
});

it("updates live server reports without replacing unsaved configuration",async()=>{
 integrated();const reload=vi.fn();const view=render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={reload}/>);
 await screen.findByText("已达额度");fireEvent.click(screen.getByRole("button",{name:"管理"}));
 fireEvent.change(screen.getByLabelText("服务器名称"),{target:{value:"Unsaved draft"}});
 view.rerender(<NetworkServers data={{servers:[{...machine,ipv4:"203.0.113.10",ipv4_seen_at:1792800000}],assignments:[],credentials:[]}} reload={reload}/>);
 expect(screen.getByLabelText("服务器名称")).toHaveProperty("value","Unsaved draft");
 expect(screen.getByText("已收到服务器 IP。双栈域名需要 IPv4 和 IPv6 均有效。")).toBeTruthy();
 expect(screen.queryByText("尚未收到本机 IP：请生成上报命令，并在此服务器执行。")).toBeNull();
});

import {serverReportStatus} from "./ServerTrafficSummary";
it("distinguishes incomplete dual-stack reports from stale reports and disabled servers",()=>{
 expect(serverReportStatus({...machine,family:"dual",ipv4:"203.0.113.10",ipv4_seen_at:1000},1000)).toBe("待上报 IPv6");
 expect(serverReportStatus({...machine,ipv4:"203.0.113.10",ipv4_seen_at:1},1000)).toContain("上报已过期");
 expect(serverReportStatus({...machine,ipv4:"203.0.113.10",ipv4_seen_at:1000},1000)).toBe("IP 上报正常");
 expect(serverReportStatus({...machine,enabled:false},1000)).toBe("已停用");
});

it("polls only an open clean server manager and releases its timer",async()=>{
 integrated();const reload=vi.fn();const view=render(<NetworkServers data={{servers:[machine],assignments:[],credentials:[]}} reload={reload}/>);
 await screen.findByText("已达额度");fireEvent.click(screen.getByRole("button",{name:"管理"}));
 const timer=vi.spyOn(window,"setInterval");const clear=vi.spyOn(window,"clearInterval");
 fireEvent.change(screen.getByLabelText("服务器名称"),{target:{value:"Draft"}});
 expect(clear).toHaveBeenCalled();expect(timer).not.toHaveBeenCalled();
 view.unmount();vi.restoreAllMocks();
});
