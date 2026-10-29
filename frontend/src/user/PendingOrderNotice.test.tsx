// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const request = vi.hoisted(() => vi.fn());
vi.mock("../shared/api", () => ({ request, money: (v: number) => `CNY ${v / 100}`, bytes: String }));
vi.mock("../shared/i18n", () => ({ tx: (v: string) => v }));
vi.mock("../shared/credit-copy", () => ({ c: (v: string) => v }));
vi.mock("../shared/ui", () => ({ Modal: ({ children }: any) => <div>{children}</div> }));
import { PendingOrderNotice } from "./PendingOrderNotice";
const order = { trade_no: "pending-1", status: 0, total_amount: 3880, plan: { name: "Basic" } };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("requires confirmation before cancelling and refreshes the order list", async () => {
    const reload = vi.fn();
    request.mockResolvedValue({});
    render(<PendingOrderNotice order={order} reload={reload} />);
    expect(screen.getByText("待支付").getAttribute("data-tone")).toBe("warning");
    fireEvent.click(screen.getByRole("button", { name: "取消订单" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认取消订单" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith("user/order/cancel", { trade_no: "pending-1" });
});
it("shows a cancellation error and refreshes authoritative order state", async () => {
    const reload = vi.fn();
    request.mockRejectedValue(new Error("Order already paid"));
    render(<PendingOrderNotice order={order} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "取消订单" }));
    fireEvent.click(screen.getByRole("button", { name: "确认取消订单" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Order already paid");
    expect(reload).toHaveBeenCalledOnce();
});
it("replaces payment and cancellation actions when provisioning starts", () => {
    const view = render(<PendingOrderNotice order={order} reload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "取消订单" }));
    view.rerender(<PendingOrderNotice order={{ ...order, status: 1 }} reload={vi.fn()} />);
    expect(screen.getByText("开通中").getAttribute("data-tone")).toBe("info");
    expect(screen.getByRole("link", { name: "查看开通进度" }).getAttribute("href")).toBe("#/order/pending-1");
    expect(screen.queryByRole("link", { name: "继续支付" })).toBeNull();
    expect(screen.queryByRole("button", { name: /取消/ })).toBeNull();
});
it("continues an order in its parent checkout without navigation or a payment request", () => {
    const resume = vi.fn();
    render(<PendingOrderNotice order={order} reload={vi.fn()} onContinue={resume} />);
    fireEvent.click(screen.getByRole("button", { name: "继续支付" }));
    expect(resume).toHaveBeenCalledWith("pending-1");
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "继续支付" })).toBeNull();
});
it.each([0,1])("resumes a subscription in the original plan confirmation for status %s",status=>{
    render(<PendingOrderNotice order={{...order,status,plan_id:2,period:"year_price",type:2,credit_bytes:null}} reload={vi.fn()}/>);
    expect(screen.getByRole("link",{name:status===0?"继续支付":"查看开通进度"}).getAttribute("href")).toBe("#/plan/2?order=pending-1");
    expect(request).not.toHaveBeenCalled();
});
it.each([{period:"reset_price",plan_id:2},{period:"deposit",plan_id:2},{period:"year_price",plan_id:2,credit_bytes:10},{period:"year_price",plan_id:2,type:5}])("keeps special order recovery in its dedicated flow: %o",details=>{
    render(<PendingOrderNotice order={{...order,...details}} reload={vi.fn()}/>);
    expect(screen.getByRole("link",{name:"继续支付"}).getAttribute("href")).toBe("#/order/pending-1");
});
