// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const request=vi.fn().mockResolvedValue({data:true});
vi.mock("../shared/api",()=>({admin:(s:string)=>s,request:(...args:any[])=>request(...args)}));
vi.mock("../shared/ui",()=>({useData:()=>({data:{app:{}},reload:vi.fn()}),State:({children}:any)=><>{children}</>}));
vi.mock("./AdminClientReleases",()=>({AdminClientReleases:()=> <p>Smart updates</p>}));
vi.mock("./admin",()=>({resources:{clients:{}},ResourcePage:()=> <p>Policy editor</p>}));
import { AdminClients } from "./AdminClients";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("combines recommendations and policy editing in one page",async()=>{
 const view=render(<AdminClients/>);
 fireEvent.change(screen.getByLabelText("macOS 主推荐"),{target:{value:"flclash"}});
 fireEvent.click(screen.getByRole("button",{name:"保存推荐"}));
 await waitFor(()=>expect(request).toHaveBeenCalledWith("config/save",{client_primary_macos:"flclash"}));
 fireEvent.click(screen.getByRole("button",{name:"访问与版本策略"}));
 expect(window.location.hash).toBe("#/clients");
 view.rerender(<AdminClients initialTab="policy"/>);
 expect(screen.getByText("Policy editor")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"推荐与智能更新"}));
 expect(window.location.hash).toBe("#/client-releases");
 view.rerender(<AdminClients/>);
 expect(screen.getByText("Smart updates")).toBeTruthy();
});
it("opens the policy route without loading recommendation settings",()=>{
 render(<AdminClients initialTab="policy"/>);
 expect(screen.getByText("Policy editor")).toBeTruthy();
});

it("submits recommendations once and preserves the selection after a failed save", async () => {
 let reject!: (reason: Error) => void;
 request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject=fail; }));
 render(<AdminClients/>);
 fireEvent.change(screen.getByLabelText("macOS 主推荐"), {target:{value:"flclash"}});
 const save=screen.getByRole("button",{name:"保存推荐"});
 fireEvent.click(save);fireEvent.click(save);
 expect(request).toHaveBeenCalledTimes(1);
 expect((save as HTMLButtonElement).disabled).toBe(true);
 reject(new Error("临时保存失败"));
 await screen.findByText("临时保存失败");
 expect((screen.getByLabelText("macOS 主推荐") as HTMLSelectElement).value).toBe("flclash");
 expect((save as HTMLButtonElement).disabled).toBe(false);
});
