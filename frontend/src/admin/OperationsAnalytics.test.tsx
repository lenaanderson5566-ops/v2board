// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
const api = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import {
    OperationsAnalytics,
    OperationsDetails,
    type OperationsReport,
} from "./OperationsAnalytics";
import { ReportTable } from "./ReportTable";
import { AdminAnalytics } from "./AdminAnalytics";
import type { DashboardFirstPurchaseData } from "./FirstPurchaseReport";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
const at = "2026-10-19T02:00:00Z";
function firstPurchaseFixture(): Extract<DashboardFirstPurchaseData, { available: true }> {
    return { available: true, from: at, to: at, windowDays: 7, registered: 10,
        funding: { externalOnly: 1, mixed: 1, walletOnly: 2, manual: 1, unclassified: 0 },
        verifiedRecurringAccounts: 4, verifiedCreditAccounts: 2 };
}
function fixture(): OperationsReport {
    const access = {
        available: true,
        total: 4,
        success: 3,
        failed: 1,
        unknown: 0,
        successRate: 0.75,
        latestAt: at,
        reasons: [{ reason: "password_error", count: 1 }],
    };
    return {
        from: "2026-09-20T16:00:00Z",
        to: at,
        generatedAt: at,
        timeZone: "Asia/Shanghai",
        retention: {
            login_log_retention_days: 30,
            subscribe_log_retention_days: 0,
            risk_log_retention_days: 0,
            mail_log_retention_days: 0,
            payment_callback_retention_days: 30,
        },
        login: access,
        subscription: { ...access, reasons: [{ reason: "expired", count: 1 }] },
        risk: {
            available: true,
            rules: [
                {
                    rule: "订阅高频",
                    hits: 10,
                    users: 2,
                    confirmed: 2,
                    falsePositive: 1,
                    ignored: 1,
                    pending: 6,
                    coverage: 0.4,
                    falsePositiveRate: 0.25,
                },
            ],
        },
        payments: {
            available: true,
            channels: [
                {
                    channel: "示例渠道",
                    currency: "CNY",
                    orders: 2,
                    paid: 1,
                    completed: 1,
                    paidRate: 0.5,
                    averagePaymentWaitSeconds: 100,
                },
                {
                    channel: "示例渠道",
                    currency: "USD",
                    orders: 1,
                    paid: 0,
                    completed: 0,
                    paidRate: 0,
                    averagePaymentWaitSeconds: null,
                },
            ],
            callbacksAvailable: true,
            callbacks: [
                {
                    channel: "示例渠道",
                    total: 3,
                    handled: 2,
                    failed: 1,
                    acknowledged: 0,
                },
            ],
            pendingActivation: 1,
            oldestActivationWaitSeconds: 120,
        },
        mail: {
            available: true,
            providers: [
                {
                    provider: "smtp",
                    stream: "transactional",
                    total: 5,
                    accepted: 2,
                    failed: 1,
                    uncertain: 1,
                    other: 1,
                    acceptedRate: 0.4,
                    delivered: 1,
                    negative: 1,
                    averageTransportMs: 300,
                    latestAt: at,
                },
            ],
        },
        health: {
            checks: [
                {
                    key: "queue",
                    label: "Horizon 队列",
                    status: "error",
                    message: "队列主进程未运行或已暂停",
                },
            ],
            queues: [
                {
                    name: "order_handle",
                    length: 3,
                    waitSeconds: 12,
                    processes: 1,
                },
            ],
            failedJobsRetained: 2,
            lastPruneAt: null,
            dailyTasks: [
                {
                    task: "reset:traffic",
                    scheduledAt: "00:00",
                    status: "completed",
                    lastSuccessAt: at,
                },
            ],
        },
    };
}
function setup(data = fixture()) {
    api.request.mockResolvedValue({ data });
}
it("keeps subscription notice categories distinct in the administrative failure report", async () => {
    const data = fixture();
    const outcomes = [
        ["traffic_exhausted", "流量已耗尽"],
        ["credits_expired", "独立额度已过期"],
        ["credits_exhausted", "独立额度已用尽"],
        ["no_available_nodes", "暂无可用节点"],
        ["subscription_changed", "订阅状态已变化"],
    ];
    data.subscription = { ...data.subscription, reasons: outcomes.map(([reason]) => ({ reason, count: 1 })) };
    setup(data);
    render(<OperationsAnalytics days={7} section="security" />);
    const report = (await screen.findByRole("heading", { name: "订阅获取质量" })).closest("section")!;
    for (const [reason, label] of outcomes) {
        expect(within(report).getByText(label)).toBeTruthy();
        expect(within(report).queryByText(reason)).toBeNull();
    }
    expect(within(report).queryByText("其他／历史原因")).toBeNull();
});
it("keeps report bounds and daily schedules in the business zone while generation uses the admin display zone", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Shanghai", true);
    setAdminDisplayTimeZone("America/New_York");
    setup();
    try {
        const view = render(<OperationsAnalytics days={30} />);
        const note = await screen.findByText(/统计区间（业务时区 Asia\/Shanghai）/);
        expect(note.textContent).toContain("2026/09/21 00:00:00");
        expect(note.textContent).toContain("2026/10/19 10:00:00");
        expect(note.textContent).toContain("2026/10/18 22:00:00");
        expect(screen.getByText("业务时区执行时间")).toBeTruthy();
        expect(screen.getByText("00:00")).toBeTruthy();
        const reads = api.request.mock.calls.length;
        setAdminDisplayTimeZone("UTC");
        view.rerender(<OperationsAnalytics days={30} />);
        expect(note.textContent).toContain("2026/09/21 00:00:00");
        expect(note.textContent).toContain("2026/10/19 02:00:00");
        expect(api.request).toHaveBeenCalledTimes(reads);
    } finally { setAdminDisplayTimeZone("business"); }
});
it("shows review denominators, separate currencies, callback counts and honest latency labels", async () => {
    setup();
    render(<OperationsAnalytics days={30} />);
    await screen.findByRole("heading", { name: "登录质量" });
    expect(screen.getAllByText("75%")).toHaveLength(2);
    expect(screen.getByText("密码错误")).toBeTruthy();
    expect(screen.getByText("账户已到期")).toBeTruthy();
    const risk = screen
        .getByRole("heading", { name: "风控规则效果" })
        .closest("section")!;
    expect(within(risk).getByText("25%")).toBeTruthy();
    expect(within(risk).getByText("40%")).toBeTruthy();
    expect(screen.getByText("CNY")).toBeTruthy();
    expect(screen.getByText("USD")).toBeTruthy();
    expect(screen.getByText("平均下单至付款")).toBeTruthy();
    expect(screen.getByText(/现有记录无法精确计算/)).toBeTruthy();
    expect(screen.getByText("预计清空耗时")).toBeTruthy();
    expect(screen.getByText("异常")).toBeTruthy();
    expect(screen.getByText("结果不确定")).toBeTruthy();
    expect(screen.getByText(/服务商接受不代表送达/)).toBeTruthy();
});
it("distinguishes missing sources and queue failures from healthy zero", async () => {
    const data = fixture();
    data.login.available = false;
    data.risk.available = false;
    data.payments.callbacksAvailable = false;
    data.health.queues = null;
    data.health.dailyTasks = null;
    data.health.failedJobsRetained = null;
    setup(data);
    render(<OperationsAnalytics days={90} />);
    await screen.findByText("日志表不可用，无法统计。");
    expect(screen.getByText("回调历史表不可用。")).toBeTruthy();
    expect(screen.getByText("队列指标读取失败，请检查 Horizon。")).toBeTruthy();
    expect(screen.getAllByText(/所选范围超过保留期/).length).toBeGreaterThan(0);
});
it("renders empty denominators as unavailable and offers a refresh", async () => {
    const data = fixture();
    data.login = {
        ...data.login,
        total: 0,
        success: 0,
        failed: 0,
        successRate: null,
        latestAt: null,
        reasons: [],
    };
    data.risk.rules = [];
    data.mail.providers = [];
    data.health.queues = [];
    setup(data);
    render(<OperationsAnalytics days={7} />);
    await screen.findByRole("heading", { name: "登录质量" });
    const login = screen
        .getByRole("heading", { name: "登录质量" })
        .closest("section")!;
    expect(within(login).getByText("—")).toBeTruthy();
    expect(within(login).getByText("当前范围暂无记录。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新运营报表" }));
    await waitFor(() => expect(api.request.mock.calls.length).toBe(2));
    expect(
        api.request.mock.calls.every(
            ([path]) => path === "test-admin/analytics/operations?days=7",
        ),
    ).toBe(true);
});
it("reloads for the selected range and displays request errors", async () => {
    setup();
    const view = render(<OperationsAnalytics days={7} />);
    await screen.findByRole("heading", { name: "登录质量" });
    api.request.mockRejectedValue(new Error("报表读取失败"));
    view.rerender(<OperationsAnalytics days={90} />);
    await screen.findByText("报表读取失败");
    expect(api.request.mock.calls.at(-1)?.[0]).toBe(
        "test-admin/analytics/operations?days=90",
    );
});
it("uses the traffic and conversion projections and keeps observed intent separate from verified orders", async () => {
    api.request.mockImplementation(async (path: string) => ({
        data: path.includes("/operations")
            ? fixture()
            : {
                  settings: { enabled: true, retentionDays: 30 },
                  ready: true,
                  timeZone: "Asia/Shanghai",
                  from: at,
                  to: at,
                  effectiveFrom: at,
                  collectionStartedAt: at,
                  previous: null,
                  ...(path.includes("view=conversion") ? {
                      firstPurchase: { ...firstPurchaseFixture(), verifiedRecurringAccounts: 4, verifiedCreditAccounts: 2 },
                      funnel: [{ step: "plan", sessions: 10 }, { step: "confirmation", sessions: 4 }, { step: "payment", sessions: 3 }],
                  } : {
                      daily: [{ date: "2026-10-18", sessions: 0, available: false }, { date: "2026-10-19", sessions: 10, available: true }],
                      sessions: 10,
                      sourceCoverage: { known: 4, unknown: 4, historical: 2 },
                      sources: [{ domain: "partner.example.test", sessions: 4, paymentEntries: 2 }],
                  }),
              },
    }));
    render(<AdminAnalytics />);
    await screen.findByRole("heading", { name: "访问会话与趋势" });
    expect(screen.getAllByRole("tab").map(tab=>tab.textContent)).toEqual(["访问概览","购买转化","体验问题"]);
    expect(screen.getByRole("row", {name:/partner.example.test.*4.*2.*50%/})).toBeTruthy();
    expect(screen.getByText(/来源未知 4 个，历史未采集 2 个/).textContent).toContain("4 / 10");
    expect(screen.getByText(/当前没有可对照的上期采集数据/)).toBeTruthy();
    expect(screen.queryByText("页面浏览")).toBeNull();
    expect(screen.queryByRole("heading", {name:"访问浏览器与系统"})).toBeNull();
    expect(api.request.mock.calls.every(([path])=>!path.includes("/operations") && !path.includes("/journey"))).toBe(true);
    fireEvent.mouseDown(screen.getByRole("tab",{name:"购买转化"}),{button:0,ctrlKey:false});
    await screen.findByRole("heading",{name:"新用户付费转化 · 7 天观察窗"});
    expect(screen.getByText("周期套餐首购").parentElement?.textContent).toContain("40%");
    expect(screen.getByText("独立额度包购买").parentElement?.textContent).toContain("20%");
    expect(screen.getByText(/人工确认首购 1 个/)).toBeTruthy();
    expect(screen.getByText(/进入付款页只代表到达/)).toBeTruthy();
    expect(screen.queryByRole("heading",{name:"外部订单回调确认金额"})).toBeNull();
    expect(screen.queryByRole("heading",{name:/注册后的业务转化/})).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab",{name:"访问概览"}),{button:0,ctrlKey:false});
    fireEvent.change(screen.getByLabelText("统计范围"),{target:{value:"90"}});
    await waitFor(()=>expect(api.request.mock.calls.some(([p])=>p.includes("days=90") && p.includes("view=traffic"))).toBe(true));
    fireEvent.change(screen.getByLabelText("访问设备"), {
        target: { value: "mobile" },
    });
    await waitFor(() =>
        expect(
            api.request.mock.calls.some(([p]) => p.includes("device=mobile")),
        ).toBe(true),
    );
    expect(
        api.request.mock.calls
            .filter(([p]) => p.includes("/operations"))
            .every(([p]) => !p.includes("device")),
    ).toBe(true);
});

it("shows missing traffic and immature conversion samples without displaying a zero-percent conversion", async () => {
    api.request.mockImplementation(async (path: string) => ({ data: {
        settings: { enabled: false, retentionDays: 30 }, ready: true, timeZone: "Asia/Shanghai",
        from: at, to: at, effectiveFrom: at, collectionStartedAt: null,
        ...(path.includes("view=conversion") ? {
            firstPurchase: { ...firstPurchaseFixture(), registered: 0, verifiedRecurringAccounts: 0, verifiedCreditAccounts: 0 },
            funnel: [],
        } : { daily: [], sessions: 0, previous: null, sourceCoverage: null, sources: [] }),
    } }));
    render(<AdminAnalytics />);
    expect(await screen.findByText("当前范围没有可用的访问采集样本。")).toBeTruthy();
    expect(screen.queryByText(/本期已采集会话/)).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "购买转化" }), { button: 0, ctrlKey: false });
    expect((await screen.findByText("周期套餐首购")).parentElement?.textContent).toContain("—");
    expect(screen.getByText("独立额度包购买").parentElement?.textContent).toContain("—");
    expect(screen.getByText("当前没有可计算购买路径的套餐浏览会话。")).toBeTruthy();
});

it("labels existing-log IP totals and renders masked addresses without implying unique users", async () => {
    const data = fixture();
    data.login.clients = {
        uniqueIps: 2,
        unknownIpEvents: 1,
        browsers: [{ category: "wechat", total: 4, success: 3, failed: 1 }],
        topIps: [{ maskedIp: "192.0.2.***", total: 4, failed: 1, accounts: 2 }],
        countries: [{ country: "未知", total: 4 }],
    };
    setup(data);
    render(<OperationsAnalytics days={7} />);
    expect(await screen.findByText("192.0.2.***")).toBeTruthy();
    expect(screen.getByText("微信")).toBeTruthy();
    expect(screen.getByText(/IP 数不等于用户数/)).toBeTruthy();
    expect(screen.queryByText("192.0.2.1")).toBeNull();
});

it("paginates browser detail rows without losing the last partial page", () => {
    const view = render(
        <ReportTable
            headers={["浏览器"]}
            rows={Array.from({ length: 21 }, (_, i) => [`Browser ${i}`])}
            pageSize={20}
        />,
    );
    expect(screen.queryByText("Browser 20")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("Browser 20")).toBeTruthy();
    expect(screen.queryByText("Browser 0")).toBeNull();
    view.rerender(
        <ReportTable
            headers={["浏览器"]}
            rows={[["New browser"]]}
            pageSize={20}
        />,
    );
    expect(screen.getByText("New browser")).toBeTruthy();
});
it.each([
    ["security", "登录质量", "支付与开通质量"],
    ["delivery", "支付与开通质量", "登录质量"],
    ["health", "队列与定时任务健康", "邮件发送与送达"],
] as const)(
    "limits %s to relevant reports",
    async (section, visible, hidden) => {
        setup();
        render(<OperationsAnalytics days={7} section={section} />);
        expect(
            await screen.findByRole("heading", { name: visible }),
        ).toBeTruthy();
        expect(screen.queryByRole("heading", { name: hidden })).toBeNull();
    },
);

it("loads relocated operational details only when expanded",async()=>{
    setup(fixture());
    render(<OperationsDetails section="security"/>);
    expect(api.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"查看登录与订阅质量"}));
    await screen.findByRole("heading",{name:"登录质量"});
    expect(screen.queryByRole("heading",{name:"队列健康"})).toBeNull();
});
