// @vitest-environment jsdom
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
import { Overview, RankChart } from "./admin-dashboard";
import { UsersPage } from "./admin-users";
import { OrdersPage } from "./admin-orders";
import { AdminInvitations } from "./AdminInvitations";
import { AdminSubscriptions } from "./AdminSubscriptions";
import AdminContent from "./admin-entry";
import { legacyAdminMenu } from "./admin-shell";
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
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("shows yearly income and lazily switches to risk without removed dashboard blocks", async () => {
    render(<Overview />);
    expect(await screen.findByText("本年度收入")).toBeTruthy();
    expect(screen.getByText("上年度同期收入")).toBeTruthy();
    expect(screen.queryByText("上月佣金支出")).toBeNull();
    expect(screen.queryByText("近 31 天运营记录")).toBeNull();
    expect(screen.queryByText("系统设置")).toBeNull();
    expect(
        api.request.mock.calls.some(([path]) => path.includes("risk/summary")),
    ).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "风控概览" }));
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
        screen.getByRole("img", { name: "流量排行横向柱状图" }),
    ).toBeTruthy();
    expect(screen.getByTitle(/guest@example.com/)).toBeTruthy();
    expect(screen.getByText("12.00 GB")).toBeTruthy();
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
        fireEvent.click(screen.getByRole("button", { name, pressed: false }));
        expect(screen.getByRole("columnheader", { name })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name, pressed: true }));
        expect(screen.queryByRole("columnheader", { name })).toBeNull();
    }
});
it("keeps commission amounts, records and approval out of order management", async () => {
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "订单详情" }));
    await screen.findByText("折抵订单");
    for (const text of ["佣金金额", "实际佣金", "佣金记录", "佣金审核"])
        expect(screen.queryByText(text)).toBeNull();
});
it("searches invitation relationships and submits commission approval through the existing contract", async () => {
    render(<AdminInvitations />);
    await screen.findByText(/inviter@example.com/);
    fireEvent.change(screen.getByRole("textbox", { name: "邀请人邮箱" }), {
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
    fireEvent.click(screen.getByRole("tab", { name: "佣金审核" }));
    fireEvent.click(await screen.findByRole("button", { name: "佣金审核" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("combobox"), {
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
    expect(legacyAdminMenu.find(([key]) => key === "online")?.[3]).toBe("用户");
    const groups = legacyAdminMenu
        .map((item) => item[3])
        .filter((group, index, all) => group !== all[index - 1]);
    expect(new Set(groups).size).toBe(groups.length);
});

it("opens system monitoring only on its dashboard tab", async () => {
    render(<Overview />);
    expect(
        api.request.mock.calls.some(([path]) => path.includes("getQueueStats")),
    ).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "系统监控" }));
    await screen.findByText("队列状态");
    expect(
        api.request.mock.calls.some(([path]) => path.includes("getQueueStats")),
    ).toBe(true);
});
it("loads translations from subscription management and supports old links", async () => {
    const view = render(<AdminSubscriptions />);
    expect(
        screen.getByRole("tab", { name: "订阅套餐", selected: true }),
    ).toBeTruthy();
    expect(
        api.request.mock.calls.some(([path]) => path.includes("ops/i18n/plan")),
    ).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "订阅多语言" }));
    await screen.findByText("选择套餐后开始翻译");
    expect(
        api.request.mock.calls.some(([path]) =>
            path.includes("ops/i18n/plan/locales"),
        ),
    ).toBe(true);
    view.unmount();
    render(<AdminContent current="translations" />);
    expect(
        screen.getByRole("tab", { name: "订阅多语言", selected: true }),
    ).toBeTruthy();
});
it("consolidates settings and monitoring navigation", () => {
    for (const key of ["system", "risk-settings", "translations"])
        expect(legacyAdminMenu.some(([item]) => String(item) === key)).toBe(
            false,
        );
    expect(legacyAdminMenu.find(([key]) => key === "log-settings")?.[3]).toBe(
        "日志",
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
        screen.getByText("FlClash/0.8.0", { selector: "summary" }),
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
    render(<Settings />);
    fireEvent.click(
        await screen.findByRole("button", { name: "专用客户端下载" }),
    );
    expect(screen.queryByText("android · 主推荐客户端")).toBeNull();
    expect(screen.queryByText("android · 备选客户端")).toBeNull();
    expect(await screen.findByText("FastAI 客户端下载与更新")).toBeTruthy();
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
    expect(keys[keys.indexOf("last_connected_at") + 1]).toBe("last_subscribe_at");
    render(<UsersPage />);
    const picker = screen.getByLabelText("可选显示列");
    for (const [, label] of resources.users.columns) expect(within(picker).getByRole("button", { name: label })).toBeTruthy();
    const connection = within(picker).getByRole("button", { name: "上次连接" });
    expect(connection.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(connection);
    expect(connection.getAttribute("aria-pressed")).toBe("false");
});

it("restores saved user columns and can reset defaults", () => {
    localStorage.setItem("admin.users.view.v1", JSON.stringify({columns:["last_connected_at"],pageSize:20,sort:"created_at",direction:"ASC"}));
    const view = render(<UsersPage />);
    const picker = screen.getByLabelText("可选显示列");
    expect(within(picker).getByRole("button", {name:"上次订阅时间"}).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(picker).getByRole("button", {name:"恢复默认展示"}));
    expect(within(screen.getByLabelText("可选显示列")).getByRole("button", {name:"上次订阅时间"}).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem("admin.users.view.v1")!).pageSize).toBe(10);
    view.unmount(); localStorage.removeItem("admin.users.view.v1");
});
