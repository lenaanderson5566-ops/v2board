// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn(),loading:false,error:"",data:{items:[],published:{},targets:{cmfa:["cmfa_android"]}} as any}));
vi.mock("../shared/api",()=>({admin:(s:string)=>s,ops:(s:string)=>s,request:mocks.request,rows:(v:any)=>v||[],bytes:(v:any)=>String(v),date:(v:any)=>String(v)}));
vi.mock("../shared/ui",()=>({useData:()=>({data:mocks.data,reload:mocks.reload,loading:mocks.loading,error:mocks.error}),State:({children}:any)=><>{children}</>}));
import { AdminClientMirrors } from "./AdminClientMirrors";
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.loading=false;mocks.error="";});
it("uses current policy to skip disabled recommendations",async()=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]},policyReasons:{cmfa:"客户端策略已禁用"}};
 const clients=[{id:"cmfa",version:"1.2.0",assets:[{id:8,name:"universal.apk",size:12}]}];
 mocks.request.mockImplementation(async(path:string)=>({data:path==="config/fetch"?{app:{}}:path==="client/mirrors/fetch"?mocks.data:clients}));
 render(<AdminClientMirrors clients={clients}/>);
 fireEvent.click(screen.getByRole("button",{name:"下载全部推荐客户端"}));
 await waitFor(()=>expect(screen.getByText(/已加入 0 个下载任务/)).toBeTruthy());
 expect(mocks.request.mock.calls.some(c=>c[0]==="client/mirrors/download")).toBe(false);
 expect(screen.getAllByText(/已跳过：客户端策略已禁用/).length).toBeGreaterThan(0);
});
it("downloads recommendations from an empty mirror library and deduplicates universal packages",async()=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]}};
 const clients=[{id:"cmfa",name:"CMFA",version:"2",assets:[{id:8,name:"universal.apk",size:12}]}];
 mocks.request.mockImplementation(async(path:string)=>path==="config/fetch"?{data:{app:{}}}:path==="client/mirrors/fetch"?{data:mocks.data}:{data:clients});
 render(<AdminClientMirrors clients={clients}/>);
 fireEvent.click(screen.getByRole("button",{name:"下载全部推荐客户端"}));
 await waitFor(()=>expect(screen.getByText(/已加入 1 个下载任务/)).toBeTruthy());
 const downloads=mocks.request.mock.calls.filter(c=>c[0]==="client/mirrors/download");
 expect(downloads).toHaveLength(1);
 expect(downloads[0][1]).toEqual({client:"cmfa",target:"cmfa_android",asset_id:8,auto_publish:true});
});
it("does not queue stale packages when checking a recommended client fails",async()=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]}};
 mocks.request.mockImplementation(async(path:string)=>{if(path==="config/fetch")return {data:{app:{}}};if(path==="client/mirrors/fetch")return {data:mocks.data};throw new Error("offline");});
 render(<AdminClientMirrors clients={[{id:"cmfa",version:"old",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
 fireEvent.click(screen.getByRole("button",{name:"下载全部推荐客户端"}));
 await waitFor(()=>expect(screen.getByText(/已加入 0 个下载任务/)).toBeTruthy());
 expect(mocks.request.mock.calls.some(c=>c[0]==="client/mirrors/download")).toBe(false);
});
it("automatically selects the sole platform and universal package",async()=>{
 mocks.request.mockResolvedValue({data:{}});
 render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
 fireEvent.click(screen.getByText("手动选择安装包"));
 expect((screen.getByLabelText("官方安装包") as HTMLSelectElement).value).toBe("8");
 fireEvent.change(screen.getByLabelText("目标系统"),{target:{value:"cmfa_android"}});
 fireEvent.change(screen.getByLabelText("官方安装包"),{target:{value:"8"}});
 fireEvent.click(screen.getByRole("button",{name:"下载到服务器"}));
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("client/mirrors/download",{client:"cmfa",asset_id:8,target:"cmfa_android"}));
 expect(mocks.reload).toHaveBeenCalled();
});
it("does not allow publishing an unfinished download",()=>{
 mocks.data={items:[{id:"a",name:"test.apk",status:"failed",target:"cmfa_android",client:"cmfa",error:"校验失败"}],published:{},targets:{cmfa:["cmfa_android"]}};
 render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA"}]}/>);
 expect(screen.queryByRole("button",{name:"发布为默认镜像"})).toBeNull();
 expect(screen.getByRole("alert").textContent).toContain("校验失败");
});

it("shows per-device reasons and opens manual selection after checking",async()=>{
 mocks.data={items:[{id:"old",client:"cmfa",target:"cmfa_android",name:"old.apk",size:12,asset_id:99,status:"ready"}],published:{},targets:{cmfa:["cmfa_android"]}};
 const clients=[{id:"cmfa",name:"CMFA",version:"2",assets:[{id:8,name:"universal.apk",size:12}]}];
 mocks.request.mockImplementation(async(path:string)=>({data:path==="client/mirrors/fetch"?mocks.data:clients}));
 render(<AdminClientMirrors clients={clients}/>);
 fireEvent.click(screen.getByRole("button",{name:"一键下载更新"}));
 await waitFor(()=>expect(screen.getByText(/原安装包架构不明确/)).toBeTruthy());
 expect(mocks.request.mock.calls.every(call=>call[0]!=="client/mirrors/download")).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"手动选择"}));
 expect((screen.getByLabelText("目标系统") as HTMLSelectElement).value).toBe("cmfa_android");
 expect(document.activeElement).toBe(screen.getByLabelText("官方安装包"));
});

it("prevents a second batch and stops following work when leaving during configuration reads",async()=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]}};
 let finish!: (result:any)=>void;
 mocks.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
 const start=screen.getByRole("button",{name:"下载全部推荐客户端"});
 fireEvent.click(start);fireEvent.click(start);
 expect(mocks.request).toHaveBeenCalledTimes(1);
 expect((screen.getByRole("button",{name:"刷新状态"}) as HTMLButtonElement).disabled).toBe(true);
 view.unmount();
 await act(async()=>finish({data:{app:{}}}));
 expect(mocks.request).toHaveBeenCalledTimes(1);
 expect(mocks.reload).not.toHaveBeenCalled();
});
it("aborts an in-flight version check and never queues downloads after unmount",async()=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]}};
 let finish!: (result:any)=>void;
 let signal!: AbortSignal;
 mocks.request.mockImplementation(async(path:string,_body:any,options:any)=>{
  if(path==="config/fetch")return {data:{app:{}}};
  if(path==="client/releases/check"){signal=options.signal;return new Promise(resolve=>{finish=resolve;});}
  return {data:mocks.data};
 });
 const view=render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
 fireEvent.click(screen.getByRole("button",{name:"下载全部推荐客户端"}));
 await waitFor(()=>expect(signal).toBeTruthy());
 view.unmount();
 expect(signal.aborted).toBe(true);
 await act(async()=>finish({data:[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}));
 expect(mocks.request.mock.calls.some(call=>call[0]==="client/mirrors/download")).toBe(false);
 expect(mocks.reload).not.toHaveBeenCalled();
});
it.each(["loading","error"])("blocks mutations when the mirror source is %s", condition=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]}};
 if(condition==="loading")mocks.loading=true;else mocks.error="刷新失败";
 render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
 expect((screen.getByRole("button",{name:"下载全部推荐客户端"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"下载全部推荐客户端"}));
 expect(mocks.request).not.toHaveBeenCalled();
});

it("stops the batch on rate limiting and keeps retry and refresh disabled during its deadline",async()=>{
 mocks.data={items:[],published:{},targets:{cmfa:["cmfa_android"]}};
 mocks.request.mockRejectedValue(Object.assign(new Error("稍后重试"),{status:429,retryAfter:60}));
 render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
 const start=screen.getByRole("button",{name:"下载全部推荐客户端"}) as HTMLButtonElement;
 fireEvent.click(start);
 await screen.findByText("稍后重试");
 expect(start.disabled).toBe(true);
 expect((screen.getByRole("button",{name:"刷新状态"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(start);
 expect(mocks.request).toHaveBeenCalledTimes(1);
 expect(mocks.reload).not.toHaveBeenCalled();
});

it("pauses background polling and version checks during a mutation cooldown",async()=>{
 vi.useFakeTimers();
 const visible=vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
 mocks.data={items:[{id:"queued",client:"cmfa",target:"cmfa_android",status:"queued"}],published:{},targets:{cmfa:["cmfa_android"]}};
 mocks.request.mockRejectedValue(Object.assign(new Error("稍后重试"),{status:429,retryAfter:60}));
 const check=vi.fn();
 const view=render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA"}]} checkUpdates={check}/>);
 try{
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"下载全部推荐客户端"}));});
  const trigger=screen.getByRole("button",{name:"一键检查更新"}) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
  expect(mocks.reload).not.toHaveBeenCalled();
  expect(check).not.toHaveBeenCalled();
 }finally{view.unmount();visible.mockRestore();vi.useRealTimers();}
});
