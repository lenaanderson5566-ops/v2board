// @vitest-environment jsdom
import {it,expect,vi,afterEach,beforeEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
const request=vi.hoisted(()=>vi.fn().mockResolvedValue({data:true}));
vi.mock("../shared/api",()=>({request,ops:(s:string)=>s,date:(s:unknown)=>String(s)}));
vi.mock("../shared/ui",()=>({Modal:({children}:any)=><div role="dialog">{children}</div>}));
import {AdminRiskReview} from "./AdminRiskReview";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
beforeEach(()=>{request.mockReset().mockResolvedValue({data:true});});
it("shows numeric evidence and saves a review for the selected event",async()=>{
 render(<AdminRiskReview row={{id:7,rule_key:"login",payload:{threshold:5,failed_count:6}}}/>);
 fireEvent.click(screen.getByRole("button",{name:/证据/}));
 expect(screen.getByText("失败次数")).toBeTruthy();expect(screen.getByText("6")).toBeTruthy();
 fireEvent.change(screen.getByRole("combobox"),{target:{value:"false_positive"}});
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"共享出口"}});
 fireEvent.click(screen.getByRole("button",{name:"保存复核"}));
 await waitFor(()=>expect(request).toHaveBeenCalledWith("log/rule-hit/review",{id:7,state:"false_positive",note:"共享出口"}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
});

it("confirms discarding a review and reopens the saved values",()=>{
 const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
 render(<AdminRiskReview row={{id:7,payload:{}}}/>);
 fireEvent.click(screen.getByRole("button",{name:/证据/}));
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"Draft note"}});
 fireEvent.click(screen.getByRole("button",{name:"取消"}));
 expect(screen.getByRole("dialog")).toBeTruthy();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"取消"}));
 expect(screen.queryByRole("dialog")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/证据/}));
 expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});
it("blocks duplicate review saves and preserves the note for retry",async()=>{
 let reject!: (error:Error)=>void;
 request.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
 render(<AdminRiskReview row={{id:8,payload:{}}}/>);
 fireEvent.click(screen.getByRole("button",{name:/证据/}));
 const note=screen.getByRole("textbox") as HTMLTextAreaElement;
 fireEvent.change(note,{target:{value:"Retry note"}});
 fireEvent.submit(note.closest("form")!);fireEvent.submit(note.closest("form")!);
 expect(request).toHaveBeenCalledTimes(1);expect(note.disabled).toBe(true);
 reject(new Error("Offline"));await screen.findByText("Offline");
 expect(note.value).toBe("Retry note");expect(note.disabled).toBe(false);
 fireEvent.click(screen.getByRole("button",{name:"保存复核"}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
 expect(request).toHaveBeenCalledTimes(2);
});
