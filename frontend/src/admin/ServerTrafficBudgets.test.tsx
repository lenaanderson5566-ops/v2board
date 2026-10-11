// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
const api=vi.hoisted(()=>{window.V2BOARD={mode:"admin",adminPath:"test-admin"} as any;return {request:vi.fn()};});
vi.mock("../shared/api",async original=>({...await original<typeof import("../shared/api")>(),request:api.request,readRequest:api.request}));
import {ServerTrafficBudgets} from "./ServerTrafficBudgets";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("raises a shared quota without resetting usage or exposing child bindings",async()=>{
 api.request.mockImplementation(async(path:string)=>path.endsWith("/fetch")?{data:[{id:1,name:"Server A",limitBytes:1073741824,usedBytes:1073741824,blocked:true,countingMode:"both",resetDay:1,nodes:[{type:"v2box",id:7}],thisMonth:{uploadBytes:1,downloadBytes:2},last30Days:{uploadBytes:1,downloadBytes:2}}]}:{data:{id:1}});
 render(<ServerTrafficBudgets nodes={[{type:"v2box",id:7,name:"Root"},{type:"v2box",id:8,name:"Child",parent_id:7}]} close={()=>{}} onSaved={()=>{}}/>);
 expect(await screen.findByText("已限制")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"修改"}));
 expect(screen.queryByText(/Child/)).toBeNull();
 fireEvent.change(screen.getByLabelText(/流量限额/),{target:{value:"2"}});fireEvent.click(screen.getByRole("button",{name:"保存额度"}));
 await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/traffic-budget/save",expect.objectContaining({id:1,limitBytes:2147483648,nodes:[{type:"v2box",id:7}]})));
});
