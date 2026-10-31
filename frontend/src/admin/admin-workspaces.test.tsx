// @vitest-environment jsdom
import { adminWorkspace } from "./admin-navigation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
const api = vi.hoisted(() => {
    window.V2BOARD = {
        mode: "admin",
        adminPath: "test-admin",
        opsPath: "test-ops",
    } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
vi.mock("./payment-icons", () => ({
    paymentIcons: [],
    paymentIconInitial: (r: unknown) => r,
    resolvePaymentIcon: () => "",
}));
vi.mock("./PaymentCategoryEditor", () => ({
    PaymentCategoryEditor: () => null,
    paymentCategoryInitial: () => ({}),
}));
import { Overview, RankChart, HistoryChart } from "./admin-dashboard";
import { UsersPage } from "./admin-users";
import { OrdersPage } from "./admin-orders";
import { AdminInvitations } from "./AdminInvitations";
import { AdminSubscriptions } from "./AdminSubscriptions";
import AdminContent from "./admin-entry";
import { legacyAdminMenu } from "./admin-shell";
import { resources } from "./admin";
import { AdminPlanTranslationWorkspace } from "./AdminPlanTranslationWorkspace";
it("does not expose the retired staff role in user editing", () => {
    expect(resources.users.fields.some((field) => field.key === "is_staff")).toBe(false);
});
it("prioritizes order status and immutable order-currency amounts ahead of diagnostic columns", async () => {
    const { ResourcePage } = await import("./admin");
    api.request.mockResolvedValue({data:[{id:1,trade_no:"usd-order",currency:"USD",total_amount:1234,status:3,user_id:7}],total:1});
    render(<ResourcePage resource={resources.orders}/>);
    await screen.findByText("usd-order");
    expect(screen.getByText("USD 12.34")).toBeTruthy();
    const headers=screen.getAllByRole("columnheader").map(header=>header.textContent);
    expect(headers.slice(0,4)).toEqual(["订单号","状态","金额","用户（ID / 邮箱）"]);
    expect(headers.indexOf("金额")).toBeLessThan(headers.indexOf("套餐"));
});
const order = {
    id: 1,
    trade_no: "order-1",
    user_id: 7,
    email: "guest@example.com",
    invite_user_id: 9,
    invite_email: "inviter@example.com",
    total_amount: 1000,
    commission_balance: 100,
    commission_status: 0,
    status: 3,
};
beforeEach(() => {
    sessionStorage.clear();
    window.location.hash = "#/overview";
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("stat/getOverride"))
            return {
                data: {
                    year_income: 12300,
                    last_year_income: 45600,
                    last_year_same_period_income: 23400,
                },
            };
        if (path.includes("getSystemStatus"))
            return { data: { horizon: true, schedule: true } };
        if (path.includes("risk/summary")) return { data: {} };
        if (path.includes("order/fetch")) return { data: [order], total: 1 };
        if (path.includes("order/detail"))
            return { data: { ...order, commission_log: [] } };
        if (path.includes("user/fetch"))
            return {
                data: [
                    {
                        id: 7,
                        email: "guest@example.com",
                        invite_user_id: 9,
                        invite_email: "inviter@example.com",
                        last_connected_at: 1700000000,
                        last_login_at: 1700000010,
                        last_subscribe_at: 1700000020,
                    },
                ],
                total: 1,
            };
        return { data: [], total: 0 };
    });
});

it("restores log filters after leaving and reopening a list", async () => {
    const { ResourcePage, resources } = await import("./admin");
    api.request.mockResolvedValue({ data: [], total: 0 });
    const view = render(<ResourcePage resource={resources["access-logs-subscriptions"]} />);
    fireEvent.change(screen.getByLabelText("日志关键词"), {
        target: { value: "FastAI" },
    });
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
        expect(
            api.request.mock.calls.some(([path]) =>
                String(path).includes("keyword=FastAI"),
            ),
        ).toBe(true),
    );
    view.unmount();
    render(<ResourcePage resource={resources["access-logs-subscriptions"]} />);
    expect(
        (screen.getByLabelText("日志关键词") as HTMLInputElement).value,
    ).toBe("FastAI");
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
it("shows core income and lazily switches to risk without removed dashboard blocks", async () => {
    render(<Overview />);
    expect(await screen.findByText("本月已支付订单金额")).toBeTruthy();
    expect(screen.queryByText("上年度同期收入")).toBeNull();
    expect(screen.queryByText("本年度收入")).toBeNull();
    expect(api.request.mock.calls.some(([path]) => /get(Server|User)LastRank/.test(path))).toBe(false);
    expect(screen.queryByText("上月佣金支出")).toBeNull();
    expect(screen.queryByText("近 31 天运营记录")).toBeNull();
    expect(screen.queryByText("系统设置")).toBeNull();
    expect(
        api.request.mock.calls.some(([path]) => path.includes("risk/summary")),
    ).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "风控概览" }), { button: 0, ctrlKey: false });
    expect(window.location.hash).toBe("#/overview-risk");
    await waitFor(() =>
        expect(
            api.request.mock.calls.some(([path]) =>
                path.includes("risk/summary"),
            ),
        ).toBe(true),
    );
});
it("renders horizontal bars with full identities available", () => {
    render(
        <RankChart
            data={[{ user_id: 7, email: "guest@example.com", total: 12 }]}
            nameKey="email"
        />,
    );
    expect(
        screen.getByRole("group", { name: "流量排行横向柱状图" }),
    ).toBeTruthy();
    expect(screen.getByTitle(/guest@example.com/)).toBeTruthy();
    expect(screen.getByText("12 GiB")).toBeTruthy();
});
it("defaults to activity times and toggles optional user columns", async () => {
    render(<UsersPage />);
    expect(
        await screen.findByRole("columnheader", { name: "上次连接" }),
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "上次登录" })).toBeTruthy();
    expect(
        screen.getByRole("columnheader", { name: "上次订阅时间" }),
    ).toBeTruthy();
    for (const name of ["佣金", "权限组", "设备数"]) {
        expect(screen.queryByRole("columnheader", { name })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
        fireEvent.click(screen.getByRole("button", { name, pressed: false }));
        fireEvent.click(screen.getByRole("button", { name: "完成" }));
        expect(screen.getByRole("columnheader", { name })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
        fireEvent.click(screen.getByRole("button", { name, pressed: true }));
        fireEvent.click(screen.getByRole("button", { name: "完成" }));
        expect(screen.queryByRole("columnheader", { name })).toBeNull();
    }
}, 20000);
it("keeps commission amounts, records and approval out of order management", async () => {
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "订单详情" }));
    await screen.findByText("折抵订单");
    for (const text of ["佣金金额", "实际佣金", "佣金记录", "佣金审核"])
        expect(screen.queryByText(text)).toBeNull();
});
it("keeps order details primary and moves secondary actions into more without enabling completed-order writes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
        const view = render(<OrdersPage />);
        await screen.findByRole("button", { name: "订单详情" });
        const actions = view.container.querySelector(".table-actions > .actions")!;
        expect(within(actions as HTMLElement).getAllByRole("button").map(button => button.textContent)).toEqual(["订单详情", "更多操作"]);
        expect(screen.queryByRole("link", { name: "查看用户" })).toBeNull();
        expect(screen.queryByRole("button", { name: "标记已付款" })).toBeNull();
        fireEvent.click(within(actions as HTMLElement).getByRole("button", { name: "更多操作" }));
        expect(screen.getByRole("link", { name: "查看用户" }).getAttribute("href")).toBe("#/users?user_id=7");
        for (const name of ["标记已付款", "取消"]) {
            const button = screen.getByRole("button", { name });
            expect((button as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(button);
        }
        expect(confirm).not.toHaveBeenCalled();
        expect(api.request.mock.calls.some(([path]) => /order\/(paid|cancel)$/.test(String(path)))).toBe(false);
    } finally { confirm.mockRestore(); }
});
it.each([["标记已付款", "order/paid"], ["取消", "order/cancel"]])("preserves confirmation and the existing API for unpaid order action %s", async (label, endpoint) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    api.request.mockImplementation(async (path: string) => path.includes("order/fetch") ? { data: [{ ...order, status: 0 }], total: 1 } : { data: true });
    try {
        render(<OrdersPage />);
        fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
        fireEvent.click(screen.getByRole("button", { name: label }));
        expect(confirm).toHaveBeenCalledWith("确认执行此操作？");
        expect(api.request.mock.calls.some(([path]) => String(path).endsWith(endpoint))).toBe(false);
        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
        fireEvent.click(screen.getByRole("button", { name: label }));
        await waitFor(() => expect(api.request).toHaveBeenCalledWith(`test-admin/${endpoint}`, expect.objectContaining({ id: 1, trade_no: "order-1" })));
        expect(api.request.mock.calls.filter(([path]) => String(path).endsWith(endpoint))).toHaveLength(1);
    } finally { confirm.mockRestore(); }
});
it("keeps all order actions flat in the context menu", async () => {
    const view = render(<OrdersPage />);
    await screen.findByRole("button", { name: "订单详情" });
    fireEvent.contextMenu(view.container.querySelector("tbody tr")!, { clientX: 100, clientY: 100 });
    const context = screen.getByRole("menu");
    expect(within(context).getByRole("button", { name: "订单详情" })).toBeTruthy();
    expect(within(context).getByRole("link", { name: "查看用户" })).toBeTruthy();
    expect(within(context).queryByRole("button", { name: "更多操作" })).toBeNull();
    expect((within(context).getByRole("button", { name: "标记已付款" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(context).getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
});
it("searches complete order history on submit while preserving unrelated status filters", async () => {
    window.location.hash = "#/orders?status=0";
    render(<OrdersPage />);
    await screen.findByRole("button", { name: "订单详情" });
    api.request.mockClear();
    fireEvent.change(screen.getByLabelText("订单查询内容"), { target: { value: "order-123" } });
    expect(api.request.mock.calls.some(([path]) => String(path).includes("order/fetch"))).toBe(false);
    fireEvent.submit(screen.getByRole("form", { name: "订单快速查询" }));
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => {
        const query = new URLSearchParams(String(path).split("?")[1]);
        return query.get("filter[0][key]") === "status" && query.get("filter[0][value]") === "0" &&
            query.get("filter[1][key]") === "trade_no" && query.get("filter[1][value]") === "order-123";
    })).toBe(true));
    const summary = screen.getByLabelText("已应用的订单筛选");
    expect(summary.textContent).toContain("待支付");
    expect(summary.textContent).toContain("order-123");
    fireEvent.click(within(summary).getByRole("button", { name: "移除订单筛选条件 2" }));
    expect((screen.getByLabelText("订单查询内容") as HTMLInputElement).value).toBe("");
    expect(summary.textContent).toContain("待支付");
});
it("restores order search from applied filters and queries email without dropping advanced conditions", async () => {
    render(<OrdersPage />);
    await screen.findByRole("button", { name: "订单详情" });
    fireEvent.change(screen.getByLabelText("订单查询字段"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText("订单查询内容"), { target: { value: "guest@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "订单快速查询" }));
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => decodeURIComponent(String(path)).includes("guest@example.com"))).toBe(true));
    cleanup();
    render(<OrdersPage />);
    expect((screen.getByLabelText("订单查询字段") as HTMLSelectElement).value).toBe("email");
    expect((screen.getByLabelText("订单查询内容") as HTMLInputElement).value).toBe("guest@example.com");
});
it("clears the user email draft together with its applied filter chip", async () => {
    render(<UsersPage />);
    await screen.findByRole("button", { name: "分配订单" });
    fireEvent.change(screen.getByLabelText("搜索所有用户邮箱"), { target: { value: "guest@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "用户搜索与筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "移除筛选条件 1" }));
    expect((screen.getByLabelText("搜索所有用户邮箱") as HTMLInputElement).value).toBe("");
});
it("requires a fresh successful mail audience check after a repeated check fails", async () => {
    let rejectPreview!: (error: Error) => void;
    let previews = 0;
    const audience = { eligible: 1, not_subscribed: 0, suppressed: 0, account_disabled: 0 };
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("user/fetch")) return { data: [{ id: 7, email: "guest@example.com" }], total: 1 };
        if (path.includes("previewMailAudience")) {
            previews += 1;
            if (previews === 2) return new Promise((_, reject) => { rejectPreview = reject; });
            return { data: audience };
        }
        return { data: [] };
    });
    render(<UsersPage />);
    await screen.findByRole("button", { name: "分配订单" });
    fireEvent.click(screen.getByText("操作", { selector: "summary" }));
    const sendMail = screen.getByRole("button", { name: "发送邮件" }) as HTMLButtonElement;
    await waitFor(() => expect(sendMail.disabled).toBe(false));
    fireEvent.click(sendMail);
    const dialog = await screen.findByRole("dialog", { name: "发送用户邮件" });
    const confirmation = within(dialog).getByRole("checkbox", { name: "我已确认操作范围和人数" }) as HTMLInputElement;
    const preview = within(dialog).getByRole("button", { name: "检查收件范围" });
    expect(confirmation.disabled).toBe(true);
    fireEvent.click(preview);
    await within(dialog).findByText(/预计发送 1 人/);
    fireEvent.click(confirmation);
    expect(confirmation.checked).toBe(true);
    fireEvent.click(preview);
    await waitFor(() => expect(rejectPreview).toBeTypeOf("function"));
    expect(within(dialog).queryByText(/预计发送 1 人/)).toBeNull();
    expect(confirmation.disabled).toBe(true);
    expect(confirmation.checked).toBe(false);
    const composer = dialog.querySelector("form.mail-composer")!;
    fireEvent.submit(composer);
    expect(await within(dialog).findByText("请先确认操作范围和人数")).toBeTruthy();
    rejectPreview(new Error("Audience temporarily unavailable"));
    await within(dialog).findByText("Audience temporarily unavailable");
    expect(confirmation.disabled).toBe(true);
    expect(within(dialog).queryByText(/预计发送 1 人/)).toBeNull();
    fireEvent.submit(composer);
    expect(api.request.mock.calls.some(([path]) => String(path).includes("user/sendMail"))).toBe(false);
    fireEvent.click(preview);
    await within(dialog).findByText(/预计发送 1 人/);
    expect(confirmation.disabled).toBe(false);
    expect(confirmation.checked).toBe(false);
    expect(previews).toBe(3);
});
it("keeps a mail draft when closing is cancelled and prevents dismissing a pending send", async () => {
    let finishSend!: (response: unknown) => void;
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("user/fetch")) return { data: [{ id: 7, email: "guest@example.com" }], total: 1 };
        if (path.includes("previewMailAudience")) return { data: { eligible: 1, not_subscribed: 0, suppressed: 0, account_disabled: 0 } };
        if (path.includes("user/sendMail")) return new Promise(resolve => { finishSend = resolve; });
        return { data: [] };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
        render(<UsersPage />);
        await screen.findByRole("button", { name: "分配订单" });
        fireEvent.click(screen.getByText("操作", { selector: "summary" }));
        const sendMail = screen.getByRole("button", { name: "发送邮件" }) as HTMLButtonElement;
        await waitFor(() => expect(sendMail.disabled).toBe(false));
        fireEvent.click(sendMail);
        const dialog = await screen.findByRole("dialog", { name: "发送用户邮件" });
        fireEvent.change(within(dialog).getByLabelText("邮件主题"), { target: { value: "Service update" } });
        fireEvent.change(within(dialog).getByLabelText("邮件正文 HTML"), { target: { value: "Service details" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
        expect(confirm).toHaveBeenCalledWith("有尚未保存的修改，确认放弃？");
        expect(within(dialog).getByDisplayValue("Service update")).toBeTruthy();
        fireEvent.click(within(dialog).getByRole("checkbox", { name: "English" }));
        fireEvent.click(within(dialog).getByRole("button", { name: "检查收件范围" }));
        await within(dialog).findByText(/预计发送 1 人/);
        fireEvent.click(within(dialog).getByRole("checkbox", { name: "我已确认操作范围和人数" }));
        fireEvent.submit(dialog.querySelector("form.mail-composer")!);
        await waitFor(() => expect(finishSend).toBeTypeOf("function"));
        confirm.mockClear();
        confirm.mockReturnValue(true);
        fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.getByRole("dialog", { name: "发送用户邮件" })).toBe(dialog);
        expect(confirm).not.toHaveBeenCalled();
        expect(api.request.mock.calls.filter(([path]) => String(path).includes("user/sendMail"))).toHaveLength(1);
        expect(api.request).toHaveBeenCalledWith("test-admin/user/sendMail", expect.objectContaining({
            subject: "Service update", content: "Service details", purpose: "service", filter: [], expected_count: 1,
        }));
        finishSend({ data: {} });
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "发送用户邮件" })).toBeNull());
    } finally { confirm.mockRestore(); }
});
it("guards only changed advanced user filters and preserves applied conditions when a draft is discarded", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
        render(<UsersPage />);
        fireEvent.click(screen.getByRole("button", { name: "高级筛选" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "用户高级筛选" })).getByRole("button", { name: "关闭" }));
        expect(screen.queryByRole("dialog", { name: "用户高级筛选" })).toBeNull();
        expect(confirm).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "高级筛选" }));
        let dialog = screen.getByRole("dialog", { name: "用户高级筛选" });
        fireEvent.click(within(dialog).getByRole("button", { name: "添加条件" }));
        fireEvent.change(within(dialog).getByLabelText("筛选值 1"), { target: { value: "guest@example.com" } });
        fireEvent.keyDown(document, { key: "Escape" });
        expect(confirm).toHaveBeenCalledWith("有尚未保存的修改，确认放弃？");
        expect(within(dialog).getByDisplayValue("guest@example.com")).toBeTruthy();
        fireEvent.submit(dialog.querySelector("form.user-filters")!);
        expect(screen.queryByRole("dialog", { name: "用户高级筛选" })).toBeNull();
        expect((screen.getByLabelText("搜索所有用户邮箱") as HTMLInputElement).value).toBe("guest@example.com");
        fireEvent.click(screen.getByRole("button", { name: "高级筛选（1）" }));
        dialog = screen.getByRole("dialog", { name: "用户高级筛选" });
        fireEvent.change(within(dialog).getByLabelText("筛选值 1"), { target: { value: "discard@example.com" } });
        confirm.mockReturnValue(true);
        fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
        expect(screen.queryByRole("dialog", { name: "用户高级筛选" })).toBeNull();
        expect((screen.getByLabelText("搜索所有用户邮箱") as HTMLInputElement).value).toBe("guest@example.com");
        fireEvent.click(screen.getByRole("button", { name: "高级筛选（1）" }));
        expect(within(screen.getByRole("dialog", { name: "用户高级筛选" })).getByDisplayValue("guest@example.com")).toBeTruthy();
    } finally { confirm.mockRestore(); }
});
it("preserves an unavailable plan filter selection without replacing its submitted ID", async () => {
    const { UserFilters } = await import("./UserFilters");
    const onApply = vi.fn();
    const view = render(<UserFilters initial={[{ key: "plan_id", condition: "=", value: 99 }]}
        plans={[{ id: 42, name: "Current plan" }]} onApply={onApply} />);
    const selection = screen.getByLabelText("筛选值 1") as HTMLSelectElement;
    expect(selection.value).toBe("99");
    expect(within(selection).getByRole("option", { name: "套餐已删除或不可用 (#99)" })).toBeTruthy();
    expect(within(selection).getByRole("option", { name: "Current plan" })).toBeTruthy();
    expect(within(selection).getAllByRole("option").filter(option => (option as HTMLOptionElement).value === "null")).toHaveLength(1);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onApply).toHaveBeenCalledWith([{ key: "plan_id", condition: "=", value: 99 }]);
    fireEvent.change(selection, { target: { value: "null" } });
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onApply).toHaveBeenLastCalledWith([{ key: "plan_id", condition: "=", value: "null" }]);
});
it("ignores a late clipboard failure after a different user action has opened details", async () => {
    let reject!: (error: Error) => void;
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(() => new Promise((_, fail) => { reject = fail; })) } });
    api.request.mockImplementation(async (path: string) => path.includes("user/fetch") ? { data: [{ id: 7, email: "guest@example.com", subscribe_url: "https://example.test/private" }], total: 1 } : { data: [] });
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "复制订阅链接" }));
    fireEvent.click(screen.getByRole("button", { name: "分配订单" }));
    const dialog = await screen.findByRole("dialog");
    reject(new Error("clipboard denied"));
    await Promise.resolve();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.queryByLabelText("用户订阅链接")).toBeNull();
});
it("searches invitation relationships and submits commission approval through the existing contract", async () => {
    render(<AdminInvitations />);
    await screen.findByText(/inviter@example.com/);
    fireEvent.change(screen.getByRole("textbox", { name: "查询邮箱" }), {
        target: { value: "inviter@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
        expect(
            api.request.mock.calls.some(([path]) =>
                decodeURIComponent(path).includes("invite_by_email"),
            ),
        ).toBe(true),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "佣金审核" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByRole("button", { name: "佣金审核" }));
    fireEvent.change(await within(screen.getByRole("dialog")).findByRole("combobox"), {
        target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(
            api.request.mock.calls.filter(
                ([path]) => path === "test-admin/order/update",
            ),
        ).toEqual([
            [
                "test-admin/order/update",
                expect.objectContaining({
                    trade_no: "order-1",
                    commission_status: 1,
                }),
            ],
        ]),
    );
});
it("removes operations grouping and keeps each new group contiguous", () => {
    expect(legacyAdminMenu.some((item) => String(item[3]) === "运营中台")).toBe(
        false,
    );
    expect(legacyAdminMenu.some(([key]) => (key as string) === "usage")).toBe(
        false,
    );
    expect(legacyAdminMenu.find(([key]) => key === "online")?.[3]).toBe("用户与支持");
    const groups = legacyAdminMenu
        .map((item) => item[3])
        .filter((group, index, all) => group !== all[index - 1]);
    expect(new Set(groups).size).toBe(groups.length);
});

it("opens system monitoring only on its dashboard tab", async () => {
    render(<Overview />);
    expect(
        api.request.mock.calls.some(([path]) => path.includes("system/observability")),
    ).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "系统监控" }), { button: 0, ctrlKey: false });
    expect(window.location.hash).toBe("#/overview-system");
    await screen.findByText("性能与告警");
    expect(
        api.request.mock.calls.some(([path]) => path.includes("system/observability")),
    ).toBe(true);
});
it("loads translations from subscription management and supports old links", async () => {
    const view = render(<AdminSubscriptions />);
    expect(
        screen.getByRole("tab", { name: "套餐列表", selected: true }),
    ).toBeTruthy();
    expect(
        api.request.mock.calls.some(([path]) => path.includes("ops/i18n/plan")),
    ).toBe(false);
    // Radix activates pointer tabs on primary-button mousedown.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "套餐翻译" }), {
        button: 0,
        ctrlKey: false,
    });
    await screen.findByText("选择套餐后开始翻译");
    expect(
        api.request.mock.calls.some(([path]) =>
            path.includes("ops/i18n/plan/locales"),
        ),
    ).toBe(true);
    view.unmount();
    render(<AdminContent current="plans-translations" />);
    expect(
        await screen.findByRole("tab", { name: "套餐翻译", selected: true }),
    ).toBeTruthy();
});

const planTranslationSnapshot = () => ({
    plan_id: 7, source_language: "zh-CN",
    source_hashes: { name: "a".repeat(64), content: "b".repeat(64) },
    default: { name: "Basic", content: "最新套餐说明" },
    translations: { "en-US": {
        name: "Basic English", content: "Old manual description", version: "c".repeat(64),
        fields: { name: { status: "current", origin: "manual" }, content: { status: "outdated", origin: "manual" } },
    } },
});
it("opens the translation check after saving source text without sending it externally", async () => {
    const { ResourcePage } = await import("./admin");
    const fixture = { id: 7, name: "Basic", content: "原说明", group_id: 1, transfer_enable: 50, device_limit: 4, month_price: 1000 };
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("ops/i18n/plan/fetch")) return { data: planTranslationSnapshot() };
        if (path.includes("ops/i18n/plan/locales")) return { data: ["zh-CN", "en-US"] };
        if (path.includes("plan/save")) return { data: true, meta: { plan_id: 7, translation_source_changed: true } };
        if (path.includes("plan/fetch")) return { data: [fixture] };
        if (path.includes("server/group/fetch")) return { data: [{id: 1, name: "Default group"}] };
        return { data: [] };
    });
    render(<ResourcePage resource={resources.plans}/>);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText(/套餐名称/), { target: { value: "Basic Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并检查翻译" }));
    await screen.findByText("套餐已保存。可在这里更新缺失或过期译文，人工译文须先核对。");
    expect(screen.getByRole("dialog").textContent).toContain("套餐翻译 · Basic Updated");
    expect(api.request.mock.calls.some(([path]) => path.includes("plan/generate"))).toBe(false);
    expect(api.request.mock.calls.filter(([path]) => path.includes("plan/save"))).toHaveLength(1);
});
it("saves only manually changed fields with source and target guards", async () => {
    const snapshot = planTranslationSnapshot();
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("/save")) return { data: true };
        return { data: snapshot };
    });
    render(<AdminPlanTranslationWorkspace plan="7" locales={["zh-CN", "en-US"]}/>);
    fireEvent.click(await screen.findByText("手动编辑与核对"));
    fireEvent.change(screen.getByLabelText("翻译名称（留空沿用原名）"), {target: {value: "New local name"}});
    expect((screen.getByRole("button", {name: "生成待同步译文"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("翻译已保存");
    const body = api.request.mock.calls.find(([path]) => path.includes("/save"))?.[1];
    expect(body).toMatchObject({fields: ["name"], name: "New local name", origins: {name: "manual"}, source_hashes: snapshot.source_hashes, translation_version: "c".repeat(64)});
    expect(body).not.toHaveProperty("content");
});
it("requires an explicit review to keep an outdated manual translation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
        const snapshot = planTranslationSnapshot();
        api.request.mockImplementation(async (path: string) => path.includes("/save") ? {data: true} : {data: snapshot});
        render(<AdminPlanTranslationWorkspace plan="7" locales={["zh-CN", "en-US"]}/>);
        fireEvent.click(await screen.findByText("手动编辑与核对"));
        fireEvent.click(screen.getByRole("button", {name: "确认现有译文仍适用"}));
        await screen.findByText("现有译文已确认适用");
        expect(confirm).toHaveBeenCalledTimes(1);
        const body = api.request.mock.calls.find(([path]) => path.includes("/save"))?.[1];
        expect(body).toMatchObject({fields: ["content"], content: "Old manual description", origins: {content: "manual"}, translation_version: "c".repeat(64)});
        expect(api.request.mock.calls.some(([path]) => path.includes("/generate"))).toBe(false);
    } finally { confirm.mockRestore(); }
});
it("consolidates settings and monitoring navigation", () => {
    expect(legacyAdminMenu.some(([key]) => String(key) === "notification-blocklist")).toBe(false);
    expect(legacyAdminMenu.find(([key]) => key === "notification-settings")?.[1]).toBe("通知设置");
    for (const key of ["system", "risk-settings", "translations"])
        expect(legacyAdminMenu.some(([item]) => String(item) === key)).toBe(
            false,
        );
    expect(legacyAdminMenu.find(([key]) => key === "log-settings")?.[3]).toBe(
        "日志与诊断",
    );
});

it("renders the backend 24-hour client count", async () => {
    const { ResourcePage, resources } = await import("./admin");
    api.request.mockResolvedValue({
        data: [
            {
                client_type: "flclash",
                client_name: "FlClash",
                subscribe_flag_count_24h: 27,
                ua_last_seen_at: 1700000000,
                ua_names: "FlClash",
                top_raw_ua: "FlClash/0.8.0",
                raw_ua_stats: [{ ua: "FlClash/0.8.0", count_24h: 27 }],
                is_enabled: 1,
            },
        ],
        total: 1,
    });
    render(<ResourcePage resource={resources.clients} />);
    expect(await screen.findByText("27")).toBeTruthy();
    expect(screen.getByText("24 小时请求")).toBeTruthy();
    expect(screen.queryByText("Invalid Date")).toBeNull();
    const { date } = await import("../shared/api");
    expect(screen.getByText(date(1700000000))).toBeTruthy();
    expect(
        screen.getByText("FlClash/0.8.0", { selector: ".admin-ua-text" }),
    ).toBeTruthy();
    expect(screen.queryByText("判别依据")).toBeNull();
    expect(
        resources.clients.fields.some((field) => field.key === "client_type"),
    ).toBe(false);
});

it("keeps recommendations out of dedicated client settings", async () => {
    const { Settings } = await import("./admin");
    api.request.mockResolvedValue({
        data: {
            site: { app_name: "Test" },
            app: {
                fastai_enabled: 1,
                fastai_releases: [],
                client_primary_android: "cmfa",
                client_secondary_android: "flclash",
            },
        },
    });
    render(<Settings section="app" />);
    expect(screen.queryByText("android · 主推荐客户端")).toBeNull();
    expect(screen.queryByText("android · 备选客户端")).toBeNull();
    expect(await screen.findByText("FastAI 客户端下载与更新")).toBeTruthy();
    expect(screen.queryByText("启用 FastAI 客户端")).toBeNull();
});

it("places subscription blocking in risk rules and removes the duplicate whitelist", async () => {
    render(<AdminContent current="risk" />);
    expect(await screen.findByText("订阅访问拦截")).toBeTruthy();
    expect(await screen.findByLabelText("每账号 24 小时窗口上限")).toBeTruthy();
    expect(screen.queryByLabelText("开启 UA 白名单")).toBeNull();
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
});

it("makes every user column selectable and orders the activity times", async () => {
    const { resources } = await import("./admin");
    const keys = resources.users.columns.map(([key]) => key);
    expect(keys[keys.indexOf("last_connected_at") + 1]).toBe(
        "last_subscribe_at",
    );
    render(<UsersPage />);
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const picker = screen.getByLabelText("可选显示列");
    for (const [, label] of resources.users.columns)
        expect(
            within(picker).getByRole("button", { name: label }),
        ).toBeTruthy();
    const connection = within(picker).getByRole("button", { name: "上次连接" });
    expect(connection.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(connection);
    expect(connection.getAttribute("aria-pressed")).toBe("false");
});

it("restores saved user columns and can reset defaults", () => {
    localStorage.setItem(
        "admin.users.view.v1",
        JSON.stringify({
            columns: ["last_connected_at"],
            pageSize: 20,
            sort: "created_at",
            direction: "ASC",
        }),
    );
    const view = render(<UsersPage />);
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const picker = screen.getByLabelText("可选显示列");
    expect(
        within(picker)
            .getByRole("button", { name: "上次订阅时间" })
            .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(
        screen.getByRole("button", { name: "恢复默认展示" }),
    );
    expect(
        within(screen.getByLabelText("可选显示列"))
            .getByRole("button", { name: "上次订阅时间" })
            .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
        JSON.parse(localStorage.getItem("admin.users.view.v1")!).pageSize,
    ).toBe(10);
    view.unmount();
    localStorage.removeItem("admin.users.view.v1");
});

it("opens coupon template editing with issued-rights notice and without batch generation", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.includes("coupon/fetch") ? [{ id: 41, name: "Issued coupon", type: 2, value: 10, started_at: 1700000000, ended_at: 2000000000, show: 1, limit_use: 0, code: "issued" }] : [], total: 1 }));
    const { ResourcePage, resources } = await import("./admin");
    render(<ResourcePage resource={resources.coupons} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/已领取的券保留原优惠和有效期/)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/生成数量/)).toBeNull();
    expect(within(dialog).getByDisplayValue("Issued coupon")).toBeTruthy();
});

it("shares one plan directory across order rows and details without blocking the list", async () => {
    let finishPlans!: (value: any) => void;
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("plan/fetch")) return new Promise(resolve => { finishPlans = resolve; });
        if (path.includes("order/detail")) return { data: { ...order, plan_id: 7, commission_log: [] } };
        if (path.includes("order/fetch")) return { data: [{ ...order, plan_id: 7 }], total: 1 };
        return { data: [] };
    });
    render(<OrdersPage />);
    await screen.findByText("order-1");
    expect(screen.getAllByRole("columnheader", { name: "套餐" })).toHaveLength(1);
    expect(screen.queryByRole("columnheader", { name: "订阅计划" })).toBeNull();
    expect(screen.getAllByText("套餐加载中 (#7)").length).toBeGreaterThan(0);
    expect(api.request.mock.calls.filter(([path]) => path.includes("plan/fetch"))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "订单详情" }));
    const dialog = await screen.findByRole("dialog", { name: "订单详情" });
    await within(dialog).findByText("套餐加载中 (#7)");
    finishPlans({ data: [{ id: 7, name: "Basic" }] });
    expect(await within(dialog).findByText("Basic")).toBeTruthy();
    expect(screen.queryByText("Basic (#7)")).toBeNull();
    expect(api.request.mock.calls.filter(([path]) => path.includes("plan/fetch"))).toHaveLength(1);
});

it("keeps a deleted gift-card plan selected and submits its original ID after directory failure", async () => {
    const fixture = { id: 12, name: "Existing gift", type: 5, plan_id: 99, value: 30, started_at: 1700000000, ended_at: 2000000000 };
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("plan/fetch")) throw new Error("Directory unavailable");
        if (path.includes("giftcard/fetch")) return { data: [fixture], total: 1 };
        return { data: true };
    });
    const { ResourcePage } = await import("./admin");
    render(<ResourcePage resource={resources.giftcards} />);
    await screen.findByText("Existing gift");
    await screen.findByText("套餐信息加载失败 (#99)");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog");
    const plan = within(dialog).getByRole("combobox", { name: "套餐" }) as HTMLSelectElement;
    expect(plan.value).toBe("99");
    expect((within(plan).getByRole("option", { name: "套餐信息加载失败 (#99)" }) as HTMLOptionElement).selected).toBe(true);
    fireEvent.submit(plan.closest("form")!);
    await waitFor(() => expect(api.request.mock.calls.some(([path, body]) =>
        path.endsWith("giftcard/generate") && body.plan_id === 99,
    )).toBe(true));
});

it("preserves unavailable coupon plan restrictions alongside named selections", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: path.includes("plan/fetch")
        ? [{ id: 7, name: "Basic" }]
        : path.includes("coupon/fetch")
          ? [{ id: 41, name: "Restricted coupon", type: 2, value: 10, started_at: 1700000000, ended_at: 2000000000, limit_plan_ids: [7, 99] }]
          : true, total: 1 }));
    const { ResourcePage } = await import("./admin");
    render(<ResourcePage resource={resources.coupons} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("checkbox", { name: "Basic" })).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByRole("checkbox", { name: "套餐已删除或不可用 (#99)" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.submit(within(dialog).getByDisplayValue("Restricted coupon").closest("form")!);
    await waitFor(() => expect(api.request.mock.calls.some(([path, body]) =>
        path.endsWith("coupon/generate") && JSON.stringify(body.limit_plan_ids) === "[7,99]",
    )).toBe(true));
});

it("exposes wallet coupon templates without legacy code controls", async () => {
    const { resources } = await import("./admin");
    for (const key of ["code", "generate_codes", "limit_use_with_user"]) {
        expect(resources.coupons.fields.some(field => field.key === key)).toBe(false);
        expect(resources.coupons.columns.some(column => column[0] === key)).toBe(false);
    }
    expect(resources.coupons.fields.some(field => field.key === "public_claim")).toBe(true);
});

it("keeps ticket replies open and opens the selected user drawer without rendering HTML", async () => {
    const { AdminTickets } = await import("./admin-content");
    const attack = '<img src=x onerror=alert(1)><svg onload=alert(2)></svg>';
    const ticket = { id: 42, user_id: 7, email: "guest@example.com", subject: "Support fixture", status: 0, reply_status: 0, message: [{ id: 1, is_me: false, message: attack }] };
    api.request.mockImplementation(async (path: string, body?: any) => {
        if (path.includes("risk/user-activity/fetch")) return { data: { user: { email: ticket.email }, events: [] } };
        if (path.includes("ticket/reply")) { ticket.reply_status = 1; ticket.message.push({ id: 2, is_me: true, message: body.message }); return { data: true }; }
        if (path.includes("ticket/fetch")) return { data: new URLSearchParams(path.split("?")[1]).has("id") ? { ...ticket } : [{ ...ticket }], total: 1 };
        return { data: [] };
    });
    render(<AdminTickets />);
    fireEvent.click(await screen.findByRole("button", { name: "查看对话" }));
    const dialog = await screen.findByRole("dialog", { name: "Support fixture" });
    expect(await within(dialog).findByText(attack)).toBeTruthy();
    expect(dialog.querySelector(".messages img, .messages svg, .messages script")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /guest@example.com/ }));
    const drawer = await screen.findByRole("dialog", { name: /用户详情/ });
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => path.includes("user-activity/fetch?user_id=7"))).toBe(true));
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "Support fixture" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/回复内容/), { target: { value: "Please try again" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "发送回复" }));
    await waitFor(() => expect(screen.getByText(/已回复，等待用户反馈/)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Support fixture" })).toBeTruthy();
    expect(api.request.mock.calls.some(([path]) => path.includes("ticket/close"))).toBe(false);
    await waitFor(() => expect((screen.getByLabelText(/回复内容/) as HTMLTextAreaElement).value).toBe(""));
});

it("shares display preferences across resource lists without leaking selected columns", async () => {
    const { ResourcePage, resources } = await import("./admin");
    localStorage.removeItem(`admin.columns.${resources.orders.fetch}`);
    api.request.mockResolvedValue({ data: [], total: 0 });
    const view = render(<ResourcePage resource={resources.orders} />);
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const [key, label] = resources.orders.columns[0];
    const option = within(screen.getByLabelText("可选显示列")).getByRole("button", { name: label });
    fireEvent.click(option);
    expect(option.getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(localStorage.getItem(`admin.columns.${resources.orders.fetch}`)!).includes(key)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount();
    render(<ResourcePage resource={resources.orders} />);
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    expect(within(screen.getByLabelText("可选显示列")).getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认展示" }));
    expect(within(screen.getByLabelText("可选显示列")).getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
    localStorage.removeItem(`admin.columns.${resources.orders.fetch}`);
});

it("supports manual keyboard tabs with linked panels and skips disabled views", async () => {
    const { AdminTabs } = await import("./AdminChoices");
    const change = vi.fn();
    render(<AdminTabs label="测试视图" value="one" onChange={change} options={[
        {value:"one",label:"第一视图"},{value:"blocked",label:"不可用",disabled:true},{value:"two",label:"第二视图"}
    ]}><p>当前内容</p></AdminTabs>);
    const first = screen.getByRole("tab",{name:"第一视图"});
    expect(first.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
    first.focus();
    fireEvent.keyDown(first,{key:"ArrowRight"});
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab",{name:"第二视图"})));
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!,{key:"Enter"});
    expect(change).toHaveBeenCalledWith("two");
});
it("keeps shared filter choices from submitting forms and respects busy state", async () => {
    const { AdminChoiceGroup } = await import("./AdminChoices");
    const { AdminFilterBar } = await import("./AdminFilterBar");
    const change = vi.fn(), submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const options = [{value:"one",label:"一"},{value:"two",label:"二"}];
    const view = render(<AdminFilterBar onSubmit={submit}><AdminChoiceGroup label="筛选" value="one" options={options} onChange={change}/></AdminFilterBar>);
    fireEvent.click(screen.getByRole("button",{name:"二"}));
    expect(change).toHaveBeenCalledWith("two");
    expect(submit).not.toHaveBeenCalled();
    view.rerender(<AdminFilterBar onSubmit={submit}><AdminChoiceGroup label="筛选" value="one" options={options} onChange={change} disabled/></AdminFilterBar>);
    fireEvent.click(screen.getByRole("button",{name:"二"}));
    expect(change).toHaveBeenCalledTimes(1);
});

it("uses the same accessible table viewport for custom and standard tables", async () => {
    const { Table, TableViewport } = await import("../shared/ui");
    const action = vi.fn();
    const view = render(<Table data={[{id: 1, name: "示例"}]} columns={[["name", "名称"]]} actions={() => <button onClick={action}>编辑记录</button>} />);
    const viewport = screen.getByRole("region", {name: "数据表格"});
    expect(viewport.tabIndex).toBe(0);
    expect(viewport.querySelectorAll(".table-actions")).toHaveLength(2);
    expect(screen.getByRole("columnheader", {name: "名称"}).classList.contains("table-actions")).toBe(false);
    fireEvent.click(screen.getByRole("button", {name: "编辑记录"}));
    expect(action).toHaveBeenCalledOnce();
    view.rerender(<TableViewport aria-label="日志表"><table><thead><tr><th>时间</th></tr></thead><tbody><tr><td>2026</td></tr></tbody></table></TableViewport>);
    expect(screen.getByRole("region", {name: "日志表"}).tabIndex).toBe(0);
    expect(screen.getByRole("cell", {name: "2026"})).toBeTruthy();
});
it("keeps shared filter submissions and reset actions separate", async () => {
    const { AdminFilterBar } = await import("./AdminFilterBar");
    const submit = vi.fn(), reset = vi.fn();
    render(<AdminFilterBar onSubmit={event => {event.preventDefault();submit();}}><label>关键词<input /></label><button type="submit">执行查询</button><button type="button" onClick={reset}>清空条件</button></AdminFilterBar>);
    expect(screen.getByRole("form", {name: "筛选条件"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "清空条件"}));
    expect(reset).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "执行查询"}));
    expect(submit).toHaveBeenCalledOnce();
});

it.each(legacyAdminMenu.map(([key, title]) => [key, title]))("renders menu page %s with its shell and without page failures", async (key, title) => {
    const { adminPageFixture } = await import("./test-support/page-fixtures");
    const { default: AdminWorkspace } = await import("./admin-workspace");
    const { MfaRecoveryProvider } = await import("../shared/MfaRecovery");
    api.request.mockImplementation(async (path: string) => adminPageFixture(path));
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => new Response(JSON.stringify(adminPageFixture(String(input))), {headers: {"Content-Type": "application/json"}})));
    const view = render(<MfaRecoveryProvider><AdminWorkspace path={key} user={{email: "preview@example.com"}} logout={() => {}} /></MfaRecoveryProvider>);
    expect(screen.getByRole("heading", {level: 1, name: title})).toBeTruthy();
    await waitFor(() => expect(view.container.querySelector('.admin-content :is(.panel,.release-monitor,.risk-workspace,.risk-rule-grid)')).toBeTruthy(), {timeout: 10000});
    await waitFor(() => expect(screen.queryByText("正在加载页面…")).toBeNull(), {timeout: 10000});
    await waitFor(() => expect(view.container.querySelector('.admin-content [aria-busy="true"]')).toBeNull(), {timeout: 10000});
    expect(screen.queryByText(/此页面暂时无法加载/)).toBeNull();
    expect(screen.queryByText("页面未找到")).toBeNull();
});

it.each(["access-logs", "access-logs-subscriptions", "access-logs-connections", "access-logs-risk", "system-log", "mail-logs", "client-diagnostics"])("shows one timezone note on %s", async (current) => {
    const { configureTimeZone } = await import("../shared/timezone");
    const { adminPageFixture } = await import("./test-support/page-fixtures");
    configureTimeZone("Asia/Shanghai", true);
    api.request.mockImplementation(async (path: string) => adminPageFixture(path));
    render(<AdminContent current={current} />);
    expect((await screen.findByTestId("log-time-zone")).textContent).toContain("Asia/Shanghai");
    expect(screen.getAllByText(/Asia\/Shanghai/)).toHaveLength(1);
});

it("removes account generation and CSV export while preserving user management", async () => {
    render(<UsersPage />);
    await waitFor(() => expect((screen.getByRole("button", {name:"刷新"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("操作", {selector:"summary"}));
    expect(screen.queryByText("导出 CSV")).toBeNull();
    expect(screen.queryByText("生成用户")).toBeNull();
    expect(screen.getByRole("button", {name:"发送邮件"})).toBeTruthy();
    expect(screen.getByRole("button", {name:"批量封禁"})).toBeTruthy();
    expect(api.request.mock.calls.some(([path]) => /user\/(generate|dumpCSV)/.test(path))).toBe(false);
});

it("loads user drawer tabs on demand without replacing list filters", async () => {
    localStorage.removeItem("admin.users.view.v1");
    api.request.mockImplementation(async (path: string) => {
        if(path.includes("user-activity/fetch")) return {data:{user:{email:"drawer@example.com"},events:[]}};
        if(path.includes("user/fetch")) return {data:[{id:99,email:"drawer@example.com"}],total:1};
        return {data:[],total:0};
    });
    const view=render(<UsersPage/>);
    fireEvent.change(screen.getByLabelText("搜索所有用户邮箱"),{target:{value:"drawer@example.com"}});
    fireEvent.submit(screen.getByRole("form",{name:"用户搜索与筛选"}));
    fireEvent.click(await screen.findByRole("button",{name:/ID: 99.*drawer@example.com/}));
    const drawer=await screen.findByRole("dialog",{name:/用户详情/});
    expect(api.request.mock.calls.some(([path])=>path.includes("order/fetch") || path.includes("getStatUser") || path.includes("invite_user_id"))).toBe(false);
    const selectTab=(name:string)=>fireEvent.mouseDown(within(drawer).getByRole("tab",{name}),{button:0,ctrlKey:false});
    selectTab("邀请用户");
    await waitFor(()=>expect(api.request.mock.calls.some(([path])=>decodeURIComponent(path).includes("invite_user_id") && decodeURIComponent(path).includes("99"))).toBe(true));
    selectTab("订单");
    await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("order/fetch") && decodeURIComponent(path).includes("99"))).toBe(true));
    selectTab("流量记录");
    await waitFor(()=>expect(api.request.mock.calls.some(([path])=>path.includes("getStatUser") && path.includes("user_id=99"))).toBe(true));
    fireEvent.click(within(drawer).getByRole("button",{name:"关闭"}));
    expect((screen.getByLabelText("搜索所有用户邮箱") as HTMLInputElement).value).toBe("drawer@example.com");
    expect(screen.getByRole("button",{name:"显示设置"}).closest(".panel-head")).toBeTruthy();
    expect(view.container.querySelector('.user-toolbar-actions summary')).toBeTruthy();
});
it("keeps destructive user actions inside more and retains cancellation and confirmation", async () => {
    localStorage.removeItem("admin.users.view.v1");
    api.request.mockImplementation(async (path:string)=>path.includes("user/fetch") ? {data:[{id:98,email:"risk@example.com"}],total:1} : {data:[]});
    Object.defineProperty(HTMLElement.prototype,"hidePopover",{configurable:true,value:vi.fn()});
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    try {
        const view=render(<UsersPage/>);
        await screen.findByRole("button",{name:"分配订单"});
        fireEvent.click(screen.getByRole('button',{name:'更多操作'}));
        const menu=document.querySelector('.admin-row-popover')!;
        const reset=within(menu as HTMLElement).getByText("重置订阅");
        const remove=within(menu as HTMLElement).getByText("删除",{exact:true});
        expect(view.container.querySelectorAll('.table-actions > .actions > button')).toHaveLength(3);
        expect(screen.queryByText("TA 的订单")).toBeNull();
        fireEvent.click(reset);
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("旧链接和客户端凭据将失效"));
        expect(api.request.mock.calls.some(([path])=>path.includes("resetSecret"))).toBe(false);
        fireEvent.click(remove);
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("永久删除"));
        expect(api.request.mock.calls.some(([path])=>path.includes("delUser"))).toBe(false);
        confirm.mockReturnValue(true);
        fireEvent.click(reset);
        await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/user/resetSecret",expect.objectContaining({id:98})));
    } finally { confirm.mockRestore();delete (HTMLElement.prototype as any).hidePopover; }
});

it("refreshes every overview section from one action", async () => {
    render(<Overview />);
    const refresh = screen.getByRole("button", { name: "刷新" });
    await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
    api.request.mockClear();
    fireEvent.click(refresh);
    await waitFor(() => {
        for (const path of ["stat/getOverride", "system/getSystemStatus", "stat/getServerTodayRank", "stat/getUserTodayRank"]) {
            expect(api.request.mock.calls.some(([url]) => String(url).includes(path))).toBe(true);
        }
    });
});

it("keeps financial data available when system health cannot be checked", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("getSystemStatus")) throw new Error("health unavailable");
        return {data:path.includes("getOverride") ? {financial:{currencies:[{currency:"CNY",today_amount:12345,daily:[]}]}} : []};
    });
    render(<Overview />);
    expect(await screen.findByText("CNY 123.45")).toBeTruthy();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("系统状态暂时无法确认"));
    expect(screen.getByRole("link",{name:"查看系统监控"}).getAttribute("href")).toBe("#/overview-system");
});

it("switches trend periods and metrics locally and exposes exact daily values", async () => {
    const daily=Array.from({length:30},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,"0")}`,amount:(i+1)*123,count:i+1}));
    api.request.mockImplementation(async(path:string)=>({data:path.includes("getOverride")?{financial:{currencies:[{currency:"CNY",daily}]}}:path.includes("Rank")?[]:{horizon:true,schedule:true}}));
    render(<Overview />);
    const chart=await screen.findByRole("figure",{name:"订单金额（CNY）"});
    expect(within(chart).getAllByRole("button")).toHaveLength(30);
    api.request.mockClear();
    fireEvent.click(screen.getByRole("button",{name:"近 7 天"}));
    fireEvent.click(screen.getByRole("button",{name:"订单笔数"}));
    const counts=screen.getByRole("figure",{name:"支付订单笔数"});
    expect(within(counts).getAllByRole("button")).toHaveLength(7);
    expect(within(counts).getByRole("button",{name:"2026-10-30 · 支付订单笔数：30"})).toBeTruthy();
    fireEvent.click(within(counts).getByText("查看每日数据"));
    expect(within(counts).getByRole("columnheader",{name:"日期"})).toBeTruthy();
    expect(api.request).not.toHaveBeenCalled();
});

it("leaves gaps on the calendar axis instead of inventing zero traffic", () => {
    const {container}=render(<HistoryChart label="实际流量（GiB）" data={[
        {date:"2026-10-01",value:0}, {date:"2026-10-02",value:1},
        {date:"2026-10-03",value:null}, {date:"2026-10-05",value:2},
    ]} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    const circles=container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
    expect(Number(circles[1].getAttribute("cx"))-Number(circles[0].getAttribute("cx"))).toBe(222.5);
    expect(screen.getByRole("button",{name:"2026-10-01 · 实际流量（GiB）：0"})).toBeTruthy();
    fireEvent.focus(circles[0]);
    expect(container.querySelector("figcaption")?.textContent).toContain("2026-10-01 · 0");
    expect(container.innerHTML).not.toContain("NaN");
});

it("shows an empty trend without drawing invalid values", () => {
    const {container}=render(<HistoryChart label="订单金额" data={[{date:"2026-10-01",value:Infinity},{date:"invalid",value:4}]} />);
    expect(screen.getByText("暂无运营记录")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
});

it("groups target logs in diagnostics and loads dashboard analytics only on selection", async () => {
    expect(legacyAdminMenu.find(([key]) => key === "log-targets")?.[3]).toBe("日志与诊断");
    expect(legacyAdminMenu.some(([key]) => String(key) === "analytics")).toBe(false);
    const { adminPageFixture } = await import("./test-support/page-fixtures");
    api.request.mockImplementation(async (path: string) => adminPageFixture(path));
    render(<Overview />);
    await screen.findByText("本月已支付订单金额");
    expect(api.request.mock.calls.some(([path]) => path.includes("analytics/report"))).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", {name: "访问与转化"}), {button: 0, ctrlKey: false});
    expect(window.location.hash).toBe("#/overview-analytics");
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => path.includes("analytics/report"))).toBe(true));
});

it.each(["browser-settings","footer-settings","notification-settings","telegram-settings","account-settings","subscription-settings","ticket-settings","node-settings","client-entrypoints","payment-deposit","invitation-rules","access-blacklist-ua","access-logs-subscriptions","access-logs-connections","access-logs-risk","notification-blocklist","node-forwarding","server-lightsail"])("opens relocated route %s directly", async current => {
    const {adminPageFixture} = await import("./test-support/page-fixtures");
    api.request.mockImplementation(async (path:string)=>adminPageFixture(path));
    const view=render(<AdminContent current={current}/>);
    await waitFor(()=>expect(view.container.querySelector(".panel")).toBeTruthy());
    await waitFor(()=>expect(screen.queryByText("正在加载页面…")).toBeNull());
    expect(screen.queryByText("页面未找到")).toBeNull();
    expect(screen.queryByLabelText("系统设置分类")).toBeNull();
});
it("routes site settings tabs by URL and blocks navigation during a save", async () => {
    const {adminPageFixture} = await import("./test-support/page-fixtures");
    api.request.mockImplementation(async (path:string)=>adminPageFixture(path));
    const view=render(<AdminContent current="site-settings"/>);
    const tab=await screen.findByRole("tab",{name:"浏览器引导"});
    const content=document.createElement("div");content.className="admin-content";
    const marker=document.createElement("div");marker.dataset.saving="true";content.append(marker);document.body.append(content);
    try {
        window.location.hash="#/site-settings";
        fireEvent.mouseDown(tab,{button:0,ctrlKey:false});
        expect(window.location.hash).toBe("#/site-settings");
        marker.remove();
        fireEvent.mouseDown(tab,{button:0,ctrlKey:false});
        expect(window.location.hash).toBe("#/browser-settings");
    } finally {content.remove();view.unmount();}
});

it.each(["service-entrypoints","deposit-settings","settings","config/system","dashboard","usage","generate","analytics","operations","system","translations","ddns","risk-settings","invitation-settings","mail-blocklist","blacklist-ip","blacklist-ua","log-login","log-subscribe","log-connection","log-risk"])("rejects retired address %s without redirecting", async path => {
    const {adminPage}=await import("./admin-shell");
    expect(adminPage(path)).toBe(path);
    render(<AdminContent current={adminPage(path)} />);
    expect(await screen.findByText("页面未找到")).toBeTruthy();
});

it.each([
    ["payment-deposit","payments","支付与充值","充值规则","充值"],
    ["client-entrypoints","clients","客户端访问与接入","服务入口","服务入口"]
])("keeps low-frequency %s inside its business workspace without sidebar search", async (route,root,title,tab) => {
    const {default: AdminWorkspace} = await import("./admin-workspace");
    const {adminPageFixture} = await import("./test-support/page-fixtures");
    api.request.mockImplementation(async (path:string)=>adminPageFixture(path));
    expect(legacyAdminMenu.some(([key])=>String(key)===route)).toBe(false);
    render(<AdminWorkspace path={route} user={{email:"preview@example.com"}} logout={()=>{}}/>);
    expect(screen.getByRole("heading",{level:1,name:tab})).toBeTruthy();
    expect(await screen.findByRole("tab",{name:tab,selected:true})).toBeTruthy();
    expect(screen.queryByRole("searchbox",{name:"搜索后台功能"})).toBeNull();
    const link=within(screen.getByRole("navigation",{name:"后台导航"})).getByRole("link",{name:title});
    expect(link.getAttribute("href")).toBe("#/"+root);
    expect(api.request.mock.calls.some(([path])=>path.includes("payment/fetch") || path.includes("client/fetch"))).toBe(false);
});

it("switches financial currency without mixing amounts or requesting legacy trend",async()=>{
    api.request.mockImplementation(async(path:string)=>({data:path.includes("stat/getOverride")?{financial:{timeZone:"Asia/Shanghai",currencies:[{currency:"CNY",today_amount:12345,month_amount:20000,previous_amount:30000,average_amount:10000,month_count:2,daily:[],commission_pending_count:0},{currency:"USD",today_amount:6789,month_amount:9000,previous_amount:0,month_count:1,daily:[],commission_pending_count:0}]}}:path.includes("Rank")?[]:{}}));
    render(<Overview/>);
    expect(await screen.findByText("CNY 123.45")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("经营统计币种"),{target:{value:"USD"}});
    expect(screen.getByText("USD 67.89")).toBeTruthy();
    expect(screen.queryByText("CNY 123.45")).toBeNull();
    expect(api.request.mock.calls.some(([p])=>p.includes("stat/getOrder"))).toBe(false);
    expect(resources["access-blacklist"].title).toBe("订阅 IP 黑名单");
    expect(legacyAdminMenu.find(([key])=>key==="access-blacklist")?.[1]).toBe("订阅访问黑名单");
});


it.each(["email", "browser", "safe", "server", "footer", "app", "invite", "deposit", "telegram", "ticket", "entrypoints"])("does not fetch unrelated plan and group options for %s settings", async section => {
    const { Settings } = await import("./admin-settings");
    const { adminPageFixture } = await import("./test-support/page-fixtures");
    api.request.mockImplementation(async (path: string) => adminPageFixture(path));
    render(<Settings section={section}/>);
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => path.includes("config/fetch"))).toBe(true));
    expect(api.request.mock.calls.some(([path]) => path.includes("plan/fetch") || path.includes("server/group/fetch"))).toBe(false);
});

it("locks duplicate destructive resource actions and unlocks after a failure", async () => {
    const { ResourcePage } = await import("./admin");
    let reject!: (error: Error) => void;
    api.request.mockImplementation((path: string) => path.includes("/drop") ? new Promise((_, fail) => {reject = fail;}) : Promise.resolve({data:[{id:1,name:"测试组"}]}));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
        render(<ResourcePage resource={resources.groups}/>);
        const button = await screen.findByRole("button", {name:"删除"});
        fireEvent.click(button);fireEvent.click(button);
        expect(api.request.mock.calls.filter(([path]) => path.includes("/drop"))).toHaveLength(1);
        expect((button as HTMLButtonElement).disabled).toBe(true);
        reject(new Error("删除失败，请重试"));
        await screen.findByText("删除失败，请重试");
        expect((button as HTMLButtonElement).disabled).toBe(false);
    } finally { confirm.mockRestore(); }
});

it("keeps an unsaved subscription editor when a tab switch is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<div className="admin-content"><div data-unsaved="true"/><AdminSubscriptions/></div>);
    try {
        const tab = screen.getByRole("tab",{name:"套餐翻译"});
        fireEvent.mouseDown(tab,{button:0,ctrlKey:false});
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("tab",{name:"套餐列表"}).getAttribute("aria-selected")).toBe("true");
        view.container.querySelector('[data-unsaved]')?.setAttribute("data-saving","true");
        fireEvent.mouseDown(tab,{button:0,ctrlKey:false});
        expect(confirm).toHaveBeenCalledTimes(1);
    } finally { confirm.mockRestore(); }
});

it("opens row actions without native popover APIs and supports keyboard dismissal", async () => {
    const { AdminRowMenu } = await import("./AdminRowMenu");
    const action = vi.fn();
    render(<form onSubmit={event => {event.preventDefault();throw new Error("unexpected submit");}}><AdminRowMenu><button onClick={action}>查看详情</button><button>重置链接</button></AdminRowMenu></form>);
    const trigger = screen.getByRole("button",{name:"更多操作"});
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"查看详情"}));
    fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"重置链接"}));
    fireEvent.keyDown(document.activeElement!,{key:"Escape"});
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button",{name:"查看详情"}));
    expect(action).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("keeps a nested row action dialog mounted when the action list closes", async () => {
    const {AdminRowMenu} = await import("./AdminRowMenu");
    const {AdminUsageReset} = await import("./AdminUsageReset");
    render(<AdminRowMenu><AdminUsageReset single count={1} filters={[]} onComplete={()=>{}}/></AdminRowMenu>);
    const trigger=screen.getByRole("button",{name:"更多操作"});
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button",{name:"发放储备重置"}));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button",{name:"关闭"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
});
it("opens row actions upward with the keyboard and skips hidden or disabled actions", async () => {
    const {AdminRowMenu}=await import("./AdminRowMenu");
    render(<AdminRowMenu><button hidden>Hidden</button><button disabled>Disabled</button><button>First</button><a href="#/users">Related user</a><button>Last</button></AdminRowMenu>);
    fireEvent.keyDown(screen.getByRole("button",{name:"更多操作"}),{key:"ArrowUp"});
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"Last"}));
    fireEvent.keyDown(document.activeElement!,{key:"Home"});
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"First"}));
    fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});
    expect(document.activeElement).toBe(screen.getByRole("link",{name:"Related user"}));
    fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"Last"}));
});
it("measures row menu height before placing it near the viewport edge", async () => {
    const {AdminRowMenu}=await import("./AdminRowMenu");
    const bounds=vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement) {
        return this.classList.contains("admin-row-popover")
            ? {width:210,height:120,left:0,right:210,top:0,bottom:120,x:0,y:0,toJSON:()=>({})}
            : {width:80,height:36,left:200,right:280,top:window.innerHeight-50,bottom:window.innerHeight-14,x:200,y:0,toJSON:()=>({})};
    });
    try {
        render(<AdminRowMenu label="Measured actions"><button>Action</button></AdminRowMenu>);
        fireEvent.click(screen.getByRole("button",{name:"更多操作"}));
        expect(screen.getByRole("group",{name:"Measured actions"}).style.top).toBe(`${window.innerHeight-174}px`);
    } finally {bounds.mockRestore();}
});

it("provides peer infrastructure workspaces with bookmarkable task tabs", () => {
    for(const key of ["nodes","servers","node-domains"]){
        expect(legacyAdminMenu.find(([route])=>String(route)===key)?.[3]).toBe("节点与接入");
    }
    expect(adminWorkspace("node-services")).toBeUndefined();
    expect(adminWorkspace("node-forwarding")?.root).toBe("servers");
    expect(adminWorkspace("server-traffic")).toBeUndefined();
    expect(adminWorkspace("server-lightsail")?.root).toBe("servers");
});

it("keeps Telegram settings usable when member records are absent", async () => {
    const { AdminTelegramCommunity } = await import("./AdminTelegramCommunity");
    api.request.mockResolvedValue({data:{enabled:false}});
    render(<AdminTelegramCommunity disabled={false}/>);
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByRole("button",{name:"加入资格检查队列"})).toBeTruthy();
});

it("shows the returned row count when a management list omits its optional total", async () => {
    const { ResourcePage } = await import("./admin");
    api.request.mockResolvedValue({ data: [{ id: 1, name: "Group one" }, { id: 2, name: "Group two" }] });
    render(<ResourcePage resource={resources.groups} />);
    await screen.findByText("Group two");
    expect(screen.getByRole("navigation", { name: "分页" }).textContent).toContain("共 2 条");
    const before = api.request.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(api.request.mock.calls.length).toBeGreaterThan(before));
    expect(api.request.mock.calls.every(([path, body]) => String(path).includes("server/group/fetch") && body === undefined)).toBe(true);
});
it("does not paginate or refetch a complete management list that has more than one page of rows without total metadata", async () => {
    const { ResourcePage } = await import("./admin");
    api.request.mockResolvedValue({ data: Array.from({ length: 25 }, (_, index) => ({ id: index + 1, name: `Complete group ${index + 1}` })) });
    render(<ResourcePage resource={resources.groups} />);
    await screen.findByText("Complete group 25");
    expect(screen.getByText("Complete group 1")).toBeTruthy();
    const pager = screen.getByRole("navigation", { name: "分页" });
    expect(pager.textContent).toContain("共 25 条");
    expect(pager.textContent).toContain("共 1 页");
    expect(screen.queryByLabelText("每页显示行数")).toBeNull();
    const reads = api.request.mock.calls.length;
    for (const name of ["下一页", "末页"]) {
        const button = within(pager).getByRole("button", { name });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
    }
    expect(api.request.mock.calls).toHaveLength(reads);
});
it("returns to the last valid page after a successful refresh removes the final row", async () => {
    const { ResourcePage } = await import("./admin");
    let removed = false;
    api.request.mockImplementation(async (path: string) => {
        const params = new URLSearchParams(path.split("?")[1]);
        const page = Number(params.get("current") || 1);
        return { data: page === 2 ? removed ? [] : [{ id: 21, name: "Last group" }]
            : Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Group ${index + 1}` })), total: removed ? 20 : 21 };
    });
    render(<ResourcePage resource={resources.groups} />);
    await screen.findByText("Group 20");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("Last group");
    api.request.mockClear();
    removed = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("Group 20");
    const pages = api.request.mock.calls.map(([path]) => new URLSearchParams(String(path).split("?")[1]).get("current"));
    expect(pages).toEqual(["2", "1"]);
    expect(screen.getByRole("navigation", { name: "分页" }).textContent).toContain("第 1 页");
});
it("does not clamp a page based on unknown loading totals or a failed read", async () => {
    const { ResourcePage } = await import("./admin");
    let fail!: (error: Error) => void;
    let waiting = true;
    api.request.mockImplementation(async (path: string) => {
        const page = new URLSearchParams(path.split("?")[1]).get("current");
        if (page === "2" && waiting) return new Promise((_, reject) => { fail = reject; });
        return { data: [{ id: page === "2" ? 21 : 1, name: page === "2" ? "Last group" : "First group" }], total: 21 };
    });
    render(<ResourcePage resource={resources.groups} />);
    await screen.findByText("First group");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(fail).toBeTypeOf("function"));
    const pageOneReads = () => api.request.mock.calls.filter(([path]) => new URLSearchParams(String(path).split("?")[1]).get("current") === "1").length;
    expect(pageOneReads()).toBe(1);
    fail(new Error("Page temporarily unavailable"));
    await screen.findByText("Page temporarily unavailable");
    expect(pageOneReads()).toBe(1);
    waiting = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("Last group");
    expect(screen.getByRole("navigation", { name: "分页" }).textContent).toContain("第 2 页");
    expect(pageOneReads()).toBe(1);
});

it("keeps monetary trend precision while traffic totals omit redundant decimals", () => {
    const first = render(<HistoryChart label="订单金额（CNY）" fixed data={[{ date: "2026-10-01", value: 12 }]} />);
    expect(screen.getByRole("button", { name: "2026-10-01 · 订单金额（CNY）：12.00" })).toBeTruthy();
    first.unmount();
    const second = render(<RankChart data={[{ server_name: "invalid", total: Infinity }, { server_name: "known", total: 12.5 }]} nameKey="server_name" />);
    expect(screen.getByText("12.5 GiB")).toBeTruthy();
    expect(screen.getByText("— GiB")).toBeTruthy();
    expect(second.container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it("uses localized h23 hours and the system zone on risk chart axes", async () => {
    const { RiskOverview } = await import("./AdminRisk");
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    const { default: i18n } = await import("../shared/i18n");
    const priorLanguage = i18n.language;
    const instant = "2026-11-30T00:00:00Z";
    configureTimeZone("UTC", true);
    setDisplayTimeZone("America/New_York");
    await i18n.changeLanguage("fa-IR");
    api.request.mockResolvedValue({ data: { trend: [{ at: Date.parse(instant) / 1000, hits: 2 }] } });
    try {
        const view = render(<RiskOverview />);
        const hour = new Intl.DateTimeFormat("fa-IR", {hour: "2-digit", hourCycle: "h23", timeZone: "UTC"}).format(new Date(instant));
        await waitFor(() => expect(view.container.querySelector(".risk-trend small")?.textContent).toBe(hour));
        expect(view.container.querySelector(".risk-trend small")?.textContent).not.toMatch(/24|UTC|GMT/);
        fireEvent.click(screen.getByRole("button", {name: "近 7 天"}));
        const day = new Intl.DateTimeFormat("fa-IR", {month: "numeric", day: "numeric", timeZone: "UTC"}).format(new Date(instant));
        await waitFor(() => expect(view.container.querySelector(".risk-trend small")?.textContent).toBe(day));
    } finally { setDisplayTimeZone(null); configureTimeZone("Asia/Shanghai", true); await i18n.changeLanguage(priorLanguage); }
});
