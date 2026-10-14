// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const mocks=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn()}));
vi.mock("../shared/api",()=>({admin:(p:string)=>p,request:mocks.request}));
vi.mock("../shared/timezone",()=>({formatInstant:()=>"date"}));
vi.mock("../shared/ui",()=>({useData:(path:string)=>({loading:false,error:"",reload:mocks.reload,total:1,data:path.includes("history")?[{id:1,action:"add",administrator_id:1}]:[{recipient_hash:"a".repeat(64),email:"blocked@example.test",note:"<script>private</script>",revision:2,administrator_id:1,released_at:null}]}),State:({children}:any)=><>{children}</>,Modal:({children}:any)=><div role="dialog">{children}</div>}));
import {AdminMailBlocklist} from "./AdminMailBlocklist";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("adds a restriction with a note and escapes note markup",async()=>{
 mocks.request.mockResolvedValue({data:true});const {container}=render(<AdminMailBlocklist/>);
 expect(container.querySelector("script")).toBeNull();
 fireEvent.change(screen.getByLabelText("禁发邮箱"),{target:{value:"test@example.test"}});fireEvent.change(screen.getByLabelText("禁发备注"),{target:{value:"abuse"}});
 fireEvent.click(screen.getByRole("button",{name:"加入禁发名单"}));
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("mail-blocklist/add",{email:"test@example.test",note:"abuse"}));
});
it("sends the revision when changing a note",async()=>{
 mocks.request.mockResolvedValue({data:true});render(<AdminMailBlocklist/>);fireEvent.click(screen.getByRole("button",{name:"编辑备注"}));
 fireEvent.change(screen.getByLabelText("备注"),{target:{value:"reviewed"}});fireEvent.click(screen.getByRole("button",{name:"保存备注"}));
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("mail-blocklist/change",{recipient_hash:"a".repeat(64),revision:2,action:"note",note:"reviewed"}));
});
it("requires confirmation before releasing and never sends mail",async()=>{
 const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);render(<AdminMailBlocklist/>);fireEvent.click(screen.getByRole("button",{name:"解除禁发"}));expect(mocks.request).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);mocks.request.mockResolvedValue({data:true});fireEvent.click(screen.getByRole("button",{name:"解除禁发"}));
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("mail-blocklist/change",{recipient_hash:"a".repeat(64),revision:2,action:"release"}));confirm.mockRestore();
});
