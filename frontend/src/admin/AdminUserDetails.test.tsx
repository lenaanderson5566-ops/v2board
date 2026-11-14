// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminUserDetails } from "./AdminUserDetails";
import { logTime } from "./admin-log-time";

const readRequest = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin", opsPath: "test-ops" } as typeof window.FASTAI;
    return vi.fn();
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    readRequest,
}));

afterEach(() => {
    cleanup();
    readRequest.mockReset();
});

it("loads the selected user's credit batches on demand and opens their linked order", async () => {
    const summary = { available_bytes: 3 * 1024 ** 3, next_expiry_at: 1800000000, next_expiry_bytes: 2 * 1024 ** 3 };
    readRequest.mockImplementation(async (path: string) => {
        if (path === "test-admin/order/detail") return { data: { trade_no: "credit-order-71", plan_name: "夏季额度包", commission_log: [] } };
        if (path.startsWith("test-admin/user/creditBatches?")) return {
            total: 2,
            meta: { summary },
            data: [
                { id: 1, source: "purchase", order_id: 71, trade_no: "credit-order-71", plan_name: "夏季额度包", granted_bytes: 4 * 1024 ** 3, available_bytes: 2 * 1024 ** 3, created_at: 1750000000, expires_at: 1800000000, status: "active" },
                { id: 2, source: "upgrade", order_id: null, trade_no: null, plan_name: null, granted_bytes: null, remaining_bytes: 1024, available_bytes: 0, created_at: 1700000000, expires_at: 1760000000, status: "expired" },
            ],
        };
        return { data: { user: { email: "credit@example.com" }, events: [] } };
    });
    render(<AdminUserDetails row={{ id: 42, email: "credit@example.com" }} close={vi.fn()} />);
    expect(readRequest.mock.calls.some(([path]) => path.includes("creditBatches"))).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "流量额度包" }), { button: 0, ctrlKey: false });

    const overview = await screen.findByRole("region", { name: "流量额度概况" });
    expect(within(overview).getByText("3 GiB")).toBeTruthy();
    expect(within(overview).getByText(`${logTime(summary.next_expiry_at)} · 剩余 2 GiB`)).toBeTruthy();
    expect(readRequest).toHaveBeenCalledWith("test-admin/user/creditBatches?user_id=42&current=1&pageSize=10", undefined, false);

    const purchase = screen.getByText("夏季额度包").closest("tr")!;
    expect(within(purchase).getByText("购买")).toBeTruthy();
    expect(within(purchase).getByText("4 GiB")).toBeTruthy();
    expect(within(purchase).getByText("2 GiB")).toBeTruthy();
    expect(within(purchase).getByText(logTime(1750000000))).toBeTruthy();
    expect(within(purchase).getByText(logTime(1800000000))).toBeTruthy();
    const historic = screen.getByText("历史升级").closest("tr")!;
    expect(within(historic).getByText("未记录")).toBeTruthy();
    expect(within(historic).getByText("已到期")).toBeTruthy();
    expect(within(historic).getByText("0 B")).toBeTruthy();
    expect(within(historic).queryByRole("button", { name: /查看订单/ })).toBeNull();

    const orderTrigger = within(purchase).getByRole("button", { name: "查看订单 credit-order-71" });
    expect(orderTrigger.textContent).toBe("查看订单");
    expect(within(purchase).getByText("credit-order-71").tagName).toBe("CODE");
    fireEvent.click(orderTrigger);
    const order = await screen.findByRole("dialog", { name: "订单详情" });
    expect(await within(order).findByText("credit-order-71")).toBeTruthy();
    expect(readRequest).toHaveBeenCalledWith("test-admin/order/detail", { id: 71 }, false);
});

it("pages credit batches and returns to page one when the status filter changes", async () => {
    readRequest.mockImplementation(async (path: string) => {
        if (!path.includes("creditBatches")) return { data: { events: [] } };
        const params = new URLSearchParams(path.split("?")[1]);
        return {
            data: params.has("status") ? [] : [{ id: 1, source: "invite_first_use", status: "used", available_bytes: 0 }],
            total: params.has("status") ? 0 : 11,
            meta: { summary: { available_bytes: 0, next_expiry_at: null, next_expiry_bytes: null } },
        };
    });
    render(<AdminUserDetails row={{ id: 42 }} close={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "流量额度包" }), { button: 0, ctrlKey: false });
    await screen.findByText("暂无待到期额度");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(readRequest).toHaveBeenCalledWith("test-admin/user/creditBatches?user_id=42&current=2&pageSize=10", undefined, false);
    const filter = await screen.findByRole("group", { name: "额度包状态" });
    fireEvent.click(within(filter).getByRole("button", { name: "已到期" }));
    expect(readRequest).toHaveBeenCalledWith("test-admin/user/creditBatches?user_id=42&current=1&pageSize=10&status=expired", undefined, false);
    expect(await screen.findByText("暂无待到期额度")).toBeTruthy();
    expect(screen.queryByText("首次使用奖励")).toBeNull();
});
