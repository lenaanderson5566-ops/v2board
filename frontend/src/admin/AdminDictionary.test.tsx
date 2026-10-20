// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn(),data:{catalog:{regions:{US:{"zh-CN":"美国","en-US":"United States"}},cities:{tokyo:{"zh-CN":"东京","en-US":"Tokyo"}},cityRegions:{tokyo:"JP"},locationKinds:{tokyo:"city"}},defaults:{regions:{US:{"zh-CN":"美国","en-US":"United States"}},cities:{tokyo:{"zh-CN":"东京","en-US":"Tokyo"}}},versions:{"regions:US":2},overrides:{"regions:US":{"zh-CN":"自定义美国"}},languages:["zh-CN","en-US"]}}));
vi.mock("../shared/api",()=>({admin:(p:string)=>p,request:mocks.request}));
vi.mock("../shared/ui",()=>({useData:()=>({data:mocks.data,reload:mocks.reload,loading:false,error:""}),State:({children}:any)=>children,Modal:({children}:any)=><div role="dialog">{children}</div>}));
import { AdminDictionary } from "./AdminDictionary";
beforeEach(()=>{mocks.request.mockReset();mocks.reload.mockClear();});afterEach(cleanup);
it("searches dictionaries and submits the fixed identity with its revision",async()=>{
 mocks.request.mockResolvedValue({data:true});render(<AdminDictionary/>);
 fireEvent.change(screen.getByLabelText("搜索字典"),{target:{value:"US"}});
 fireEvent.click(screen.getByRole("button",{name:"编辑"}));
 fireEvent.change(screen.getByLabelText("zh-CN"),{target:{value:"美国线路"}});
 fireEvent.click(screen.getByRole("button",{name:"保存"}));
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("dictionary/save",{kind:"regions",code:"US",version:2,names:{"zh-CN":"美国线路"}}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());expect(mocks.reload).toHaveBeenCalled();
});
it("restores only the selected entry after explicit save",async()=>{
 mocks.request.mockResolvedValue({data:true});render(<AdminDictionary/>);fireEvent.click(screen.getByRole("button",{name:"编辑"}));
 fireEvent.click(screen.getByRole("button",{name:"恢复默认"}));expect(mocks.request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"保存"}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("dictionary/save",{kind:"regions",code:"US",version:2,names:{}}));
});
it("preserves edits on a stale-version conflict",async()=>{
 mocks.request.mockRejectedValue(new Error("字典项已被修改，请刷新"));render(<AdminDictionary/>);fireEvent.click(screen.getByRole("button",{name:"编辑"}));fireEvent.click(screen.getByRole("button",{name:"保存"}));
 expect((await screen.findByRole("alert")).textContent).toContain("请刷新");expect((screen.getByLabelText("zh-CN") as HTMLInputElement).value).toBe("自定义美国");expect(mocks.reload).not.toHaveBeenCalled();
});
it("switches country and city dictionaries without exposing editable codes",()=>{
 render(<AdminDictionary/>);fireEvent.click(screen.getByRole("button",{name:"州、省与城市"}));expect(screen.getByText("Tokyo",{exact:true})).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"编辑"}));expect(screen.getAllByRole("textbox")).toHaveLength(3);
});
