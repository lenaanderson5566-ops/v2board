// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../shared/api", () => ({ ops: (s:string)=>s, bytes: (s:unknown)=>String(s), date: (s:unknown)=>String(s), rows:(v:any)=>v || [] }));
const load = vi.hoisted(()=>vi.fn());
vi.mock("../shared/ui",()=>({useData:load, Modal:({children,close}:any)=><div role="dialog"><button onClick={close}>关闭</button>{children}</div>,State:({children}:any)=><>{children}</>}));
import { AdminUserActivityLink } from "./AdminUserActivity";
afterEach(cleanup);
it("loads only the selected user when opened and closes the drawer",()=>{
 load.mockReturnValue({data:{user:{email:"test@example.com"},events:[{id:1,kind:"登录",at:123,ip:"192.0.2.1",is_success:false}]},reload:vi.fn()});
 render(<AdminUserActivityLink row={{user_id:7,email:"test@example.com"}}/>);
 expect(screen.queryByRole("dialog")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/ID: 7/}));
 expect(load).toHaveBeenCalledWith("risk/user-activity/fetch?user_id=7");
 expect(screen.getByText("登录失败")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"关闭"}));
 expect(screen.queryByRole("dialog")).toBeNull();
});
it("does not open a user drawer for unidentified events",()=>{
 render(<AdminUserActivityLink row={{email:"unknown@example.com"}}/>);
 expect(screen.queryByRole("button")).toBeNull();
 expect(screen.getByText(/未识别用户/)).toBeTruthy();
});

it("separates event fields, filters counts and shows an empty selected category", () => {
 load.mockReturnValue({data:{user:{email:"test@example.com",banned:"0",credit_balance:0},events:[
  {id:1,kind:"订阅",at:123,ip:"192.0.2.1",traffic_u:0,traffic_d:20,user_agent:"<img src=x onerror=alert(1)>"},
  {id:2,kind:"连接",at:122,ip:"192.0.2.2",node:"Tokyo",client_type:"FastAI"},
  {id:3,kind:"风控",at:121,rule_key:"rule",rule_name:"频率检测",payload:null},
 ]},reload:vi.fn()});
 render(<AdminUserActivityLink row={{user_id:7}}/>);
 fireEvent.click(screen.getByRole("button",{name:/ID: 7/}));
 expect(screen.getByRole("region",{name:"账户概况"})).toBeTruthy();
 expect(screen.getByText("正常")).toBeTruthy();
 expect(screen.getByRole("article",{name:"订阅记录"}).querySelector("dd")?.textContent).toContain("192.0.2.1");
 expect(screen.getByText("0 / 20")).toBeTruthy();
 expect(screen.getByText("客户端标识（UA）").closest("details")?.open).toBe(false);
 expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"连接 1"}));
 expect(screen.queryByRole("article",{name:"订阅记录"})).toBeNull();
 expect(screen.getByText("Tokyo")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"登录 0"}));
 expect(screen.getByRole("status").textContent).toBe("暂无登录记录");
});
