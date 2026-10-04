// @vitest-environment jsdom
import {it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
const request=vi.hoisted(()=>vi.fn().mockResolvedValue({data:true}));
vi.mock("./api",()=>({request,ops:(s:string)=>s,date:(s:unknown)=>String(s)}));
vi.mock("./ui",()=>({Modal:({children}:any)=><div role="dialog">{children}</div>}));
import {AdminRiskReview} from "./AdminRiskReview";
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
