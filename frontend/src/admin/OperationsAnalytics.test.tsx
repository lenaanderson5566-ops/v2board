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
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import {
    OperationsAnalytics,
    type OperationsReport,
} from "./OperationsAnalytics";
import { AdminAnalytics } from "./AdminAnalytics";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
const at = "2026-10-19T02:00:00Z";
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
it("shows review denominators, separate currencies, callback counts and honest latency labels", async () => {
    setup();
    render(<OperationsAnalytics days={30} />);
    await screen.findByRole("heading", { name: "登录质量" });
    expect(screen.getAllByText("75.0%")).toHaveLength(2);
    expect(screen.getByText("密码错误")).toBeTruthy();
    expect(screen.getByText("账户已到期")).toBeTruthy();
    const risk = screen
        .getByRole("heading", { name: "风控规则效果" })
        .closest("section")!;
    expect(within(risk).getByText("25.0%")).toBeTruthy();
    expect(within(risk).getByText("40.0%")).toBeTruthy();
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
it("integrates range, device-independent operations and local access distributions in the existing page", async () => {
    api.request.mockImplementation(async (path: string) => ({
        data: path.includes("/operations")
            ? fixture()
            : {
                  settings: { enabled: false, retentionDays: 30 },
                  ready: true,
                  timeZone: "Asia/Shanghai",
                  from: at,
                  to: at,
                  latestEventAt: null,
                  effectiveFrom: at,
                  collectionStartedAt: null,
                  previous: null,
                  daily: [],
                  sessions: 0,
                  views: 0,
                  pages: [],
                  devices: [],
                  funnel: [],
                  cohort: {
                      from: at,
                      to: at,
                      windowDays: 7,
                      registered: 0,
                      ordered: 0,
                      paid: 0,
                      completed: 0,
                  },
                  hours: Array(24).fill(0),
                  weekdays: Array(7).fill(0),
              },
    }));
    render(<AdminAnalytics />);
    await screen.findByRole("heading", { name: "访问时段分布" });
    expect(screen.getByText("23:00–24:00")).toBeTruthy();
    expect(screen.getByText("周日")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("统计范围"), {
        target: { value: "90" },
    });
    await waitFor(() =>
        expect(
            api.request.mock.calls.some(
                ([p]) => p === "test-admin/analytics/operations?days=90",
            ),
        ).toBe(true),
    );
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

it("labels existing-log IP totals and renders masked addresses without implying unique users", async () => {
    const data=fixture();
    data.login.clients={uniqueIps:2,unknownIpEvents:1,browsers:[{category:"wechat",total:4,success:3,failed:1}],topIps:[{maskedIp:"192.0.2.***",total:4,failed:1,accounts:2}],countries:[{country:"未知",total:4}]};
    setup(data);
    render(<OperationsAnalytics days={7} />);
    expect(await screen.findByText("192.0.2.***")).toBeTruthy();
    expect(screen.getByText("微信")).toBeTruthy();
    expect(screen.getByText(/IP 数不等于用户数/)).toBeTruthy();
    expect(screen.queryByText("192.0.2.1")).toBeNull();
});
