// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminUserDetails } from "./AdminUserDetails";
import { logTime } from "./admin-log-time";
import AdminContent from "./admin-entry";
import { configureTimeZone, setAdminDisplayTimeZone } from "../shared/timezone";

const readRequest = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as typeof window.FASTAI;
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
        return { data: { user: { email: "credit@example.com", credit_balance: summary.available_bytes, transfer_enable: 0 }, events: [] } };
    });
    render(<AdminUserDetails row={{ id: 42, email: "credit@example.com" }} close={vi.fn()} />);
    const shortcut = await screen.findByRole("button", { name: "查看额度批次" });
    expect(readRequest.mock.calls.some(([path]) => path.includes("creditBatches"))).toBe(false);
    fireEvent.click(shortcut);
    expect(screen.getByRole("tab", { name: "流量额度包" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "流量额度批次" }));

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
        if (!path.includes("creditBatches")) return { data: { user: { credit_balance: 0 }, events: [] } };
        const params = new URLSearchParams(path.split("?")[1]);
        return {
            data: params.has("status") ? [] : [{ id: 1, source: "invite_first_use", status: "used", available_bytes: 0 }],
            total: params.has("status") ? 0 : 11,
            meta: { summary: { available_bytes: 0, next_expiry_at: null, next_expiry_bytes: null } },
        };
    });
    render(<AdminUserDetails row={{ id: 42 }} close={vi.fn()} />);
    const account = await screen.findByRole("region", { name: "账户概况" });
    expect(within(account).getByText("0 B")).toBeTruthy();
    expect(within(account).queryByRole("button", { name: "查看额度批次" })).toBeNull();
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

it("shows each traffic bucket's original business date across administrator time zone changes", async () => {
    const seconds = (iso: string) => Date.parse(iso) / 1000;
    readRequest.mockImplementation(async (path: string) => {
        if (!path.includes("/stat/getStatUser")) return { data: { user: {}, events: [] } };
        return {
            data: [
                { id: 1, record_at: seconds("2026-10-03T18:15:00Z"), record_timezone: "Asia/Kathmandu", u: 10, d: 20, server_rate: 1 },
                { id: 2, record_at: seconds("2026-10-02T16:00:00Z"), record_timezone: null, u: 11, d: 21, server_rate: 1 },
                { id: 3, record_at: seconds("2026-10-01T16:00:00Z"), record_timezone: "invalid-zone", u: 12, d: 22, server_rate: 1 },
            ],
            total: 3,
        };
    });
    configureTimeZone("UTC", true);
    setAdminDisplayTimeZone("America/Los_Angeles");
    try {
        const row = { id: 42 };
        const close = vi.fn();
        const view = render(<AdminUserDetails row={row} close={close} />);
        fireEvent.mouseDown(screen.getByRole("tab", { name: "流量记录" }), { button: 0, ctrlKey: false });
        const traffic = await screen.findByRole("table");
        expect(within(traffic).getByText("统计日期")).toBeTruthy();
        for (const [usage, day] of [["10 B", "2026-10-04"], ["11 B", "2026-10-03"], ["12 B", "2026-10-02"]]) {
            expect(await within(traffic).findByText(usage)).toBeTruthy();
            const record = within(traffic).getByText(usage).closest("tr")!;
            expect(within(record).getByText(day)).toBeTruthy();
        }
        configureTimeZone("Pacific/Kiritimati", true);
        setAdminDisplayTimeZone("Asia/Tokyo");
        view.rerender(<AdminUserDetails row={row} close={close} />);
        expect(within(within(traffic).getByText("10 B").closest("tr")!).getByText("2026-10-04")).toBeTruthy();
        expect(within(within(traffic).getByText("11 B").closest("tr")!).getByText("2026-10-03")).toBeTruthy();
        expect(readRequest.mock.calls.filter(([path]) => path.includes("/stat/getStatUser"))).toHaveLength(1);
    } finally {
        configureTimeZone("Asia/Shanghai", true);
        setAdminDisplayTimeZone("business");
    }
});

function resetQueries() {
    return readRequest.mock.calls
        .map(([path]) => String(path))
        .filter(path => path.startsWith("test-admin/user/usageResetLogs?"))
        .map(path => new URLSearchParams(path.split("?")[1]));
}

it("prefills the central reset lookup by user ID and preserves the active query across display zones", async () => {
    const iso = "2026-11-22T16:10:37.000Z";
    const timestamp = Date.parse(iso) / 1000;
    const now = Date.parse("2026-11-24T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    configureTimeZone("Asia/Shanghai", true);
    setAdminDisplayTimeZone("UTC");
    readRequest.mockImplementation(async (path: string) => {
        if (path.startsWith("test-admin/user/usageResetLogs?")) {
            const page = Number(new URLSearchParams(path.split("?")[1]).get("current"));
            return { data: [{ id: page, kind: "use", quantity: -1, u_before: 1024 ** 3,
                d_before: 2 * 1024 ** 3, batch_id: 81, created_at: timestamp }], total: 11 };
        }
        return { data: { user: {}, events: [] } };
    });
    try {
        const view = render(<AdminContent route="user-reset-history?user_id=42" />);

        const amount = await screen.findByText("3 GiB");
        expect(screen.getByLabelText<HTMLInputElement>("用户 ID 或邮箱").value).toBe("42");
        const record = amount.closest("tr")!;
        expect(record.querySelector("time")?.dateTime).toBe(iso);
        expect(record.querySelector("time")?.textContent).toContain("16:10:37");
        expect(resetQueries()[0].get("user_id")).toBe("42");
        expect(resetQueries()[0].get("kind")).toBe("use");
        expect(resetQueries()[0].has("to")).toBe(false);
        expect(Number(resetQueries()[0].get("from"))).toBe(now / 1000 - 30 * 86400);

        fireEvent.click(screen.getByRole("button", { name: "下一页" }));
        await waitFor(() => expect(resetQueries().at(-1)?.get("current")).toBe("2"));
        await screen.findByText("3 GiB");

        const start = screen.getByLabelText<HTMLInputElement>("开始时间");
        fireEvent.change(start, { target: { value: "2026-11-22T16:10:37" } });
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        await waitFor(() => {
            expect(resetQueries().at(-1)?.get("from")).toBe(String(timestamp));
            expect(resetQueries().at(-1)?.get("current")).toBe("1");
        });
        await screen.findByText("3 GiB");
        const requestCount = resetQueries().length;
        act(() => setAdminDisplayTimeZone("business"));
        expect(start.value).toContain("2026-11-23T00:10:37");
        expect(screen.getByText(/日志时间与筛选时区.*Asia\/Shanghai/)).toBeTruthy();
        expect(screen.getByText("3 GiB").closest("tr")?.querySelector("time")?.textContent).toContain("00:10:37");
        expect(resetQueries()).toHaveLength(requestCount);
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        await waitFor(() => expect(resetQueries()).toHaveLength(requestCount + 1));
        expect(resetQueries().at(-1)?.get("from")).toBe(String(timestamp));

        view.rerender(<AdminContent route="user-reset-history?user_id=43" />);
        await waitFor(() => expect(resetQueries().at(-1)?.get("user_id")).toBe("43"));
        expect(screen.getByLabelText<HTMLInputElement>("用户 ID 或邮箱").value).toBe("43");
    } finally {
        cleanup();
        clock.mockRestore();
        setAdminDisplayTimeZone("business");
    }
});

it("opens on recent resets for all users and can narrow to grants by email or widen again", async () => {
    const created_at = Date.parse("2026-11-22T16:10:37Z") / 1000;
    readRequest.mockImplementation(async (path: string) => {
        if (path.startsWith("test-admin/user/usageResetLogs?")) {
            const params = new URLSearchParams(path.split("?")[1]);
            if (params.get("kind") === "grant") return {
                data: [
                    { id: 1, kind: "grant", quantity: 2, u_before: 1024 ** 3, d_before: 2 * 1024 ** 3,
                        batch_id: 81, actor_id: 5, actor_email: "grant-admin@example.test", created_at, expiry_known: true, expires_at: null },
                    { id: 2, kind: "grant", quantity: 1, batch_id: 80, actor_id: 7, created_at, expiry_known: false, expires_at: null },
                ],
                total: 2,
            };
            if (params.get("kind") === "use") return { data: [
                { id: 4, kind: "use", user_id: 42, user_email: "target@example.test", quantity: -1, created_at,
                    u_before: 1024 ** 3, d_before: 2 * 1024 ** 3 },
                { id: 3, kind: "use", user_id: 44, user_email: null, quantity: -1, created_at },
            ], total: 2 };
            return { data: [], total: 0 };
        }
        if (path.includes("/stat/getStatUser")) return { data: [], total: 0 };
        return { data: { user: {}, events: [] } };
    });
    render(<AdminContent route="user-reset-history" />);
    const lookup = await screen.findByLabelText("用户 ID 或邮箱");
    expect(await screen.findByRole("button", { name: /target@example.test/ })).toBeTruthy();
    expect(screen.getByText("ID: 44 · 邮箱不可用")).toBeTruthy();
    expect(resetQueries()).toHaveLength(1);
    expect(resetQueries()[0].get("kind")).toBe("use");
    expect(resetQueries()[0].has("from")).toBe(true);
    expect(resetQueries()[0].has("user_id")).toBe(false);
    expect(resetQueries()[0].has("email")).toBe(false);
    fireEvent.change(lookup, { target: { value: " invalid " } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(screen.getByRole("alert").textContent).toContain("请输入用户 ID 或完整邮箱。");
    expect(resetQueries()).toHaveLength(1);
    fireEvent.change(lookup, { target: { value: " target@example.test " } });
    const kind = screen.getByRole("combobox", { name: "记录类型" });
    fireEvent.change(kind, { target: { value: "grant" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    const grant = (await screen.findByText(/grant-admin@example.test/)).closest("tr")!;
    expect(within(grant).getByText("长期有效")).toBeTruthy();
    expect(screen.getByText(/未记录/)).toBeTruthy();
    expect(screen.queryByText("3 GiB")).toBeNull();
    expect(resetQueries().at(-1)?.has("user_id")).toBe(false);
    expect(resetQueries().at(-1)?.get("email")).toBe("target@example.test");
    fireEvent.change(lookup, { target: { value: "43" } });
    expect(screen.getByText("查询用户：target@example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除时间" }));
    await waitFor(() => {
        const query = resetQueries().at(-1)!;
        expect(query.get("kind")).toBe("grant");
        expect(query.get("email")).toBe("target@example.test");
        expect(query.has("from")).toBe(false);
        expect(query.has("to")).toBe(false);
    });
    fireEvent.change(kind, { target: { value: "global" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
        const query = resetQueries().at(-1)!;
        expect(query.get("kind")).toBe("global");
        expect(query.get("user_id")).toBe("43");
        expect(query.has("email")).toBe(false);
    });
    fireEvent.change(lookup, { target: { value: "" } });
    fireEvent.change(kind, { target: { value: "use" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
        const query = resetQueries().at(-1)!;
        expect(query.get("kind")).toBe("use");
        expect(query.has("user_id")).toBe(false);
        expect(query.has("from")).toBe(true);
    });
    expect(screen.getByRole("button", { name: "恢复最近 30 天" })).toBeTruthy();
});

it("does not widen an invalid user link to all users", async () => {
    render(<AdminContent route="user-reset-history?user_id=invalid" />);
    expect((await screen.findByRole("alert")).textContent).toContain("链接中的用户 ID 无效");
    expect(resetQueries()).toHaveLength(0);
});

it("shows the current valid reset credits and a shortcut alongside daily usage in one panel", async () => {
    const expiry = Date.parse("2026-11-29T15:00:00Z") / 1000;
    readRequest.mockImplementation(async (path: string) => {
        if (path.startsWith("test-admin/user/usageResetCredits?")) {
            return { data: { available: 4, next_expires_at: expiry, next_expires_count: 2 } };
        }
        if (path.includes("/stat/getStatUser")) {
            return { data: [{ id: 1, record_at: expiry, u: 10, d: 20, server_rate: 1 }], total: 1 };
        }
        return { data: { user: {}, events: [] } };
    });
    render(<AdminUserDetails row={{ id: 42 }} close={vi.fn()} />);
    expect(readRequest.mock.calls.some(([path]) => String(path).includes("/usageResetCredits?"))).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "流量记录" }), { button: 0, ctrlKey: false });
    const summary = await screen.findByRole("region", { name: "有效储备重置" });
    expect(await within(summary).findByText("有效储备重置 4 次")).toBeTruthy();
    expect(summary.querySelector("time")?.dateTime).toBe("2026-11-29T15:00:00.000Z");
    expect(summary.textContent).toContain("· 2 次");
    expect(within(summary).getByRole("link", { name: "查看重置记录" }).getAttribute("href")).toBe("#/user-reset-history?user_id=42");
    expect(await screen.findByText("统计日期")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "储备重置" })).toBeNull();
    expect(readRequest).toHaveBeenCalledWith("test-admin/user/usageResetCredits?user_id=42", undefined, false);
    expect(resetQueries()).toHaveLength(0);
});

it("distinguishes balance-funded orders from free orders and shows a pending repeat", async () => {
    const base = { type: 1, period: "month_price", currency: "CNY", plan_name: "Basic", status: 3, total_amount: 0 };
    const orders = [
        { ...base, id: 3, trade_no: "pending-repeat", status: 0, total_amount: 1912, pending_purchase_context: "repeat" },
        { ...base, id: 2, trade_no: "paid-by-balance", balance_amount: 2390, purchase_stage: "first_purchase" },
        { ...base, id: 1, trade_no: "free-order", balance_amount: 0 },
    ];
    readRequest.mockImplementation(async (path: string) => {
        if (path.startsWith("test-admin/order/fetch?")) return { data: orders, total: orders.length };
        if (path.endsWith("/plan/fetch")) return { data: [] };
        return { data: { user: {}, events: [] } };
    });
    render(<AdminUserDetails row={{ id: 42 }} close={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "订单" }), { button: 0, ctrlKey: false });
    const pending = within((await screen.findByText("pending-repeat")).closest("tr")!);
    const balance = within(screen.getByText("paid-by-balance").closest("tr")!);
    const free = within(screen.getByText("free-order").closest("tr")!);
    expect(screen.getByRole("columnheader", { name: "外部应付" })).toBeTruthy();
    expect(pending.getByText("再次购买")).toBeTruthy();
    expect(pending.getByText("待支付")).toBeTruthy();
    expect(pending.getByText("CNY 19.12")).toBeTruthy();
    expect(balance.getByText("首购")).toBeTruthy();
    expect(balance.getByText("CNY 0.00")).toBeTruthy();
    expect(balance.getByText("余额抵扣 CNY 23.90")).toBeTruthy();
    expect(free.queryByText(/余额抵扣/)).toBeNull();
});
