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
import { Overview, RankChart } from "./admin-dashboard";
import { UsersPage } from "./admin-users";
import { OrdersPage } from "./admin-orders";
import { AdminInvitations } from "./AdminInvitations";
import { AdminSubscriptions } from "./AdminSubscriptions";
import AdminContent from "./admin-entry";
import { legacyAdminMenu } from "./admin-shell";
import { resources } from "./admin";
it("does not expose the retired staff role in user editing", () => {
    expect(resources.users.fields.some((field) => field.key === "is_staff")).toBe(false);
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
        fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
        fireEvent.click(screen.getByRole("button", { name, pressed: false }));
        fireEvent.click(screen.getByRole("button", { name: "完成" }));
        expect(screen.getByRole("columnheader", { name })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
        fireEvent.click(screen.getByRole("button", { name, pressed: true }));
        fireEvent.click(screen.getByRole("button", { name: "完成" }));
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
    await waitFor(() => expect(view.container.querySelector('.admin-content :is(.panel,.release-monitor,.risk-workspace,.risk-rule-grid)')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("正在加载页面…")).toBeNull());
    await waitFor(() => expect(view.container.querySelector('.admin-content [aria-busy="true"]')).toBeNull());
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

it("groups target logs in diagnostics and loads dashboard analytics only on selection", async () => {
    expect(legacyAdminMenu.find(([key]) => key === "log-targets")?.[3]).toBe("日志与诊断");
    expect(legacyAdminMenu.some(([key]) => String(key) === "analytics")).toBe(false);
    const { adminPageFixture } = await import("./test-support/page-fixtures");
    api.request.mockImplementation(async (path: string) => adminPageFixture(path));
    render(<Overview />);
    await screen.findByText("本月已支付订单金额");
    expect(api.request.mock.calls.some(([path]) => path.includes("analytics/report"))).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", {name: "访问与转化"}), {button: 0, ctrlKey: false});
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => path.includes("analytics/report"))).toBe(true));
});

it.each(["browser-settings","footer-settings","notification-settings","telegram-settings","account-settings","subscription-settings","ticket-settings","node-settings","client-entrypoints","payment-deposit","invitation-rules","access-blacklist-ua","access-logs-subscriptions","access-logs-connections","access-logs-risk","notification-blocklist","node-services","node-forwarding","server-lightsail"])("opens relocated route %s directly", async current => {
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
    expect(screen.getByRole("heading",{level:1,name:title})).toBeTruthy();
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

it("provides peer infrastructure workspaces with bookmarkable task tabs", () => {
    for(const key of ["nodes","servers","node-domains"]){
        expect(legacyAdminMenu.find(([route])=>String(route)===key)?.[3]).toBe("节点与接入");
    }
    expect(adminWorkspace("node-services")?.root).toBe("nodes");
    expect(adminWorkspace("node-forwarding")?.root).toBe("nodes");
    expect(adminWorkspace("server-traffic")).toBeUndefined();
    expect(adminWorkspace("server-lightsail")?.root).toBe("servers");
});
