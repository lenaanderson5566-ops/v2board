// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn(),data:{version:3,items:[{code:"flclash",name:"FlClash",defaultName:"FlClash",builtinAliases:["FlClash"],aliases:[],priority:100}],catalog:{regions:{US:{"zh-CN":"美国","en-US":"United States"}},cities:{tokyo:{"zh-CN":"东京","en-US":"Tokyo"}},cityRegions:{tokyo:"JP"},locationKinds:{tokyo:"city"}},defaults:{regions:{US:{"zh-CN":"美国","en-US":"United States"}},cities:{tokyo:{"zh-CN":"东京","en-US":"Tokyo"}}},versions:{"regions:US":2},overrides:{"regions:US":{"zh-CN":"自定义美国"}},languages:["zh-CN","en-US"]}}));
vi.mock("../shared/api",()=>({admin:(p:string)=>p,request:mocks.request}));
vi.mock("../shared/ui",()=>({useData:()=>({data:mocks.data,reload:mocks.reload,loading:false,error:""}),Pager:()=>null,TableViewport:({children}:any)=>children,State:({children}:any)=>children,Modal:({children}:any)=><div role="dialog">{children}</div>}));
import { AdminClientDictionary } from "./AdminClientDictionary";
import { AdminDictionary } from "./AdminDictionary";
beforeEach(()=>{mocks.request.mockReset();mocks.reload.mockClear();});afterEach(()=>{cleanup();vi.restoreAllMocks();});
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
 fireEvent.click(screen.getByRole("button",{name:"取消"}));expect(mocks.reload).toHaveBeenCalled();
});
it("switches country and city dictionaries without exposing editable codes",()=>{
 render(<AdminDictionary/>);fireEvent.click(screen.getByRole("button",{name:"州、省与城市"}));expect(screen.getByText("Tokyo",{exact:true})).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"编辑"}));expect(screen.getAllByRole("textbox")).toHaveLength(3);
});

it("filters custom entries and previews another language without saving",()=>{
 render(<AdminDictionary/>);
 fireEvent.change(screen.getByLabelText("预览语言"),{target:{value:"en-US"}});
 expect(screen.getAllByText("United States").length).toBeGreaterThan(0);
 fireEvent.change(screen.getByLabelText("字典来源"),{target:{value:"builtin"}});
 expect(screen.getByText("没有匹配的字典项")).toBeTruthy();
 expect(mocks.request).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("字典来源"),{target:{value:"custom"}});
 expect(screen.getByRole("button",{name:"编辑"})).toBeTruthy();
});

it("previews draft client aliases without saving and retains input after conflicts",async()=>{
 render(<AdminClientDictionary/>);
 fireEvent.click(screen.getByRole("button",{name:"编辑"}));
 fireEvent.change(screen.getByLabelText("自定义别名"),{target:{value:"ExampleClient"}});
 fireEvent.change(screen.getByLabelText("测试 UA"),{target:{value:"ExampleClient/2"}});
 mocks.request.mockResolvedValueOnce({data:{code:"flclash",name:"FlClash",source:"custom"}});
 fireEvent.click(screen.getByRole("button",{name:"测试识别"}));
 await screen.findByText(/自定义别名$/, {selector:"p"});
 expect(mocks.request).toHaveBeenCalledWith("dictionary/clients/preview",{ua:"ExampleClient/2",rules:{flclash:{name:"FlClash",aliases:["ExampleClient"],priority:100}}});
 expect(mocks.reload).not.toHaveBeenCalled();
 mocks.request.mockRejectedValueOnce(new Error("识别库已被其他管理员修改"));
 fireEvent.click(screen.getByRole("button",{name:"保存"}));
 expect((await screen.findByRole("alert")).textContent).toContain("其他管理员");
 expect((screen.getByLabelText("自定义别名") as HTMLTextAreaElement).value).toBe("ExampleClient");
 vi.spyOn(window,"confirm").mockReturnValue(true);
 fireEvent.click(screen.getByRole("button",{name:"取消"}));expect(mocks.reload).toHaveBeenCalled();
});
it("restores client defaults only after saving the current version",async()=>{
 render(<AdminClientDictionary/>);fireEvent.click(screen.getByRole("button",{name:"编辑"}));
 fireEvent.change(screen.getByLabelText("显示名称"),{target:{value:"Custom"}});
 fireEvent.click(screen.getByRole("button",{name:"恢复默认"}));expect(mocks.request).not.toHaveBeenCalled();
 mocks.request.mockResolvedValueOnce({data:true});fireEvent.click(screen.getByRole("button",{name:"保存"}));
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("dictionary/clients/save",{version:3,rules:{flclash:{name:"FlClash",aliases:[],priority:100}}}));
 await waitFor(()=>expect(mocks.reload).toHaveBeenCalled());
});

it("keeps a changed dictionary entry when discard is declined",()=>{
 const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
 render(<AdminDictionary/>);fireEvent.click(screen.getByRole("button",{name:"编辑"}));
 fireEvent.change(screen.getByLabelText("zh-CN"),{target:{value:"Unsaved country"}});
 fireEvent.click(screen.getByRole("button",{name:"取消"}));
 expect(screen.getByRole("dialog")).toBeTruthy();expect(mocks.request).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"取消"}));
 expect(screen.queryByRole("dialog")).toBeNull();
});
