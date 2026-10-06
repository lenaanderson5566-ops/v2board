// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,act,cleanup} from "@testing-library/react";
const request=vi.hoisted(()=>vi.fn().mockResolvedValue({data:1}));
vi.mock("../shared/api",()=>({request,money:(v:number)=>String(v),query:(p:string)=>p}));
vi.mock("../shared/ui",()=>({useData:()=>({data:[],loading:false,error:""}),State:({children}:any)=>children,Modal:({children}:any)=>children}));
vi.mock("./SubscriptionPurchase",()=>({PurchaseSteps:()=>null}));
vi.mock("./OrderReceipt",()=>({OrderReceipt:()=>null}));
import i18n from "../shared/i18n";
import {PaymentCheckout} from "./PaymentCheckout";
afterEach(()=>{cleanup();vi.useRealTimers();request.mockClear();});
it("pauses after 60 checks and allows restarting",async()=>{
 await i18n.changeLanguage("zh-CN");
 vi.useFakeTimers();
 render(<PaymentCheckout order={{status:1,trade_no:"test",plan_id:1}} reload={()=>{}} renderCard={()=>null}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(305000);});
 expect(request).toHaveBeenCalledTimes(60);
 expect(screen.getByText(/自动检查已暂停/)).toBeTruthy();
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"继续检查"}));});
 expect(request).toHaveBeenCalledTimes(61);
 expect(screen.queryByText(/自动检查已暂停/)).toBeNull();
});
