// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn(),data:{items:[],published:{},targets:{cmfa:["cmfa_android"]}} as any}));
vi.mock("./api",()=>({ops:(s:string)=>s,request:mocks.request,rows:(v:any)=>v||[],bytes:(v:any)=>String(v),date:(v:any)=>String(v)}));
vi.mock("./ui",()=>({useData:()=>({data:mocks.data,reload:mocks.reload}),State:({children}:any)=><>{children}</>}));
import { AdminClientMirrors } from "./AdminClientMirrors";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("automatically selects the sole platform and universal package",async()=>{
 mocks.request.mockResolvedValue({data:{}});
 render(<AdminClientMirrors clients={[{id:"cmfa",name:"CMFA",assets:[{id:8,name:"universal.apk",size:12}]}]}/>);
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
 mocks.request.mockResolvedValue({data:clients});
 render(<AdminClientMirrors clients={clients}/>);
 fireEvent.click(screen.getByRole("button",{name:"一键下载更新"}));
 await waitFor(()=>expect(screen.getByText(/原安装包架构不明确/)).toBeTruthy());
 expect(mocks.request.mock.calls.every(call=>call[0]!=="client/mirrors/download")).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"手动选择"}));
 expect((screen.getByLabelText("目标系统") as HTMLSelectElement).value).toBe("cmfa_android");
 expect(document.activeElement).toBe(screen.getByLabelText("官方安装包"));
});
