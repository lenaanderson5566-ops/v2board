// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const api=vi.hoisted(()=>{window.V2BOARD={mode:"admin",adminPath:"test-admin"} as any;return {read:vi.fn(),write:vi.fn()};});
vi.mock("../shared/api",async original=>({...await original<typeof import("../shared/api")>(),readRequest:api.read,request:api.write}));
import { MailHealth } from "./MailHealth";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
it("distinguishes delivery feedback and requires review before releasing bounces",async()=>{
    api.read.mockImplementation((path:string)=>Promise.resolve(path.includes("/health") ? {data:{counts:[{status:"accepted",delivery_status:"delivered",count:2}],suppressed:2,unmatched_events:1}} : {data:[{recipient_hash:"a".repeat(64),email:"a***@example.test",reason:"bounced",updated_at:1700000000},{recipient_hash:"b".repeat(64),email:"b***@example.test",reason:"complained",updated_at:1700000000}],total:2}));
    api.write.mockResolvedValue({data:true});
    render(<MailHealth/>);
    await screen.findByText("a***@example.test");
    const buttons=screen.getAllByRole("button",{name:"核实后恢复",hidden:true});
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    fireEvent.click(buttons[0]);expect(api.write).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);fireEvent.click(buttons[0]);
    await waitFor(()=>expect(api.write).toHaveBeenCalledWith("test-admin/mail-logs/release",{recipient_hash:"a".repeat(64),verified:true}));
    expect(screen.getByText(/不能据此计算送达率/)).toBeTruthy();
});
