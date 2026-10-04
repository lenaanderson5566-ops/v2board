// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("./api", () => ({ ops: (s:string)=>s, date: (s:unknown)=>String(s), rows:(v:any)=>v || [] }));
const load = vi.hoisted(()=>vi.fn());
vi.mock("./ui",()=>({useData:load, Modal:({children,close}:any)=><div role="dialog"><button onClick={close}>关闭</button>{children}</div>,State:({children}:any)=><>{children}</>}));
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
