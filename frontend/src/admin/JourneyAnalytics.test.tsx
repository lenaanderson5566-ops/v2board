// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    readRequest: api.request,
    request: api.request,
}));
import { JourneyAnalytics, type JourneyReport } from "./JourneyAnalytics";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
const at = "2026-10-01T00:00:00Z";
function fixture(): JourneyReport {
    return {
        business: {
            generatedAt: at,
            timeZone: "Asia/Shanghai",
            retention: { login_log_retention_days: 30 },
            usageEarliestAt: null,
            activation: {
                from: at,
                to: at,
                registered: 10,
                paid: 5,
                subscribed: 4,
                used: 3,
                averagePaymentSeconds: 100,
                averageSubscriptionSeconds: 30,
            },
            retentionCohorts: [
                {
                    day: 7,
                    from: at,
                    to: at,
                    registered: 10,
                    login: 2,
                    usage: 3,
                    loginRate: 0.2,
                    usageRate: 0.3,
                },
            ],
            active: [{ days: 7, login: 2, usage: 3 }],
            repurchase: {
                from: at,
                to: at,
                eligible: 5,
                renewed: 1,
                rate: 0.2,
            },
            expiredUnrestored: 2,
            expiryFrom: at,
            expiryTo: at,
        },
        experience: {
            available: true,
            enabled: true,
            retentionDays: 30,
            effectiveFrom: at,
            rows: [
                {
                    page: "subscribe",
                    event: "download",
                    samples: 5,
                    sessions: 3,
                    average: null,
                    p75Upper: null,
                    p95Upper: null,
                },
                {
                    page: "subscribe",
                    event: "cls",
                    samples: 4,
                    sessions: 3,
                    average: 100,
                    p75Upper: 100,
                    p95Upper: 250,
                },
            ],
        },
    };
}
it("shows mature cohorts, observed retention, honest renewal and percentile descriptions", async () => {
    api.request.mockResolvedValue({ data: fixture() });
    render(<JourneyAnalytics days={30} device="all" />);
    await screen.findByRole("heading", { name: "注册到首次使用 · 7 日观察窗" });
    expect(screen.getByText("下载点击")).toBeTruthy();
    expect(screen.getByText("P95 桶上界")).toBeTruthy();
    expect(screen.getByText("0.25")).toBeTruthy();
    expect(screen.getByText(/不计算历史流失率/)).toBeTruthy();
    expect(screen.getByText(/不能证明订阅后的精确连接顺序/)).toBeTruthy();
    expect(screen.getByText(/登录留存按登录记录统计/)).toBeTruthy();
    expect(screen.getByText(/不能代表全部访客/)).toBeTruthy();
});
it("keeps business reports available before telemetry migration and uses unavailable denominators", async () => {
    const data = fixture();
    data.experience = { available: false, rows: [] };
    data.business.activation.registered = 0;
    data.business.activation.paid = 0;
    data.business.activation.subscribed = null;
    data.business.activation.used = null;
    api.request.mockResolvedValue({ data });
    render(<JourneyAnalytics days={7} device="mobile" />);
    await screen.findByText(/体验统计表尚未安装/);
    expect(
        screen.getByRole("heading", { name: "续费与到期未恢复" }),
    ).toBeTruthy();
    expect(screen.getAllByText("不可用")).toHaveLength(2);
});
it("reloads range and device filters and reports request failures", async () => {
    api.request.mockResolvedValue({ data: fixture() });
    const view = render(<JourneyAnalytics days={7} device="desktop" />);
    await screen.findByText("下载点击");
    fireEvent.click(screen.getByRole("button", { name: "刷新旅程报表" }));
    await waitFor(() => expect(api.request.mock.calls.length).toBe(2));
    api.request.mockRejectedValue(new Error("旅程读取失败"));
    view.rerender(<JourneyAnalytics days={90} device="mobile" />);
    await screen.findByText("旅程读取失败");
    expect(api.request.mock.calls.at(-1)?.[0]).toBe(
        "test-admin/analytics/journey?days=90&device=mobile",
    );
});

it("labels a payment-provider click separately from completed business payments", async () => {
    const data = fixture();
    data.experience.rows = [
        {
            page: "payment",
            event: "payment_open",
            samples: 8,
            sessions: 3,
            average: null,
            p75Upper: null,
            p95Upper: null,
        },
    ];
    api.request.mockResolvedValue({ data });
    render(<JourneyAnalytics days={7} device="mobile" />);
    expect(await screen.findByText("点击前往付款")).toBeTruthy();
    expect(screen.getByText(/不代表支付完成/)).toBeTruthy();
    expect(
        screen.getByRole("heading", { name: "注册到首次使用 · 7 日观察窗" }),
    ).toBeTruthy();
});
it("explains opt-in sample coverage in the standalone experience report", async () => {
    api.request.mockResolvedValue({ data: fixture() });
    render(<JourneyAnalytics days={7} device="mobile" experienceOnly />);
    expect(await screen.findByText(/不能代表全部访客/)).toBeTruthy();
    expect(screen.getByText(/不应把体验事件会话数作为业务漏斗分母/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "注册到首次使用 · 7 日观察窗" })).toBeNull();
});

it("separates business cohort bounds from the generation instant in the admin display zone", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Shanghai", true);
    setAdminDisplayTimeZone("America/New_York");
    api.request.mockResolvedValue({data:fixture()});
    try {
        render(<JourneyAnalytics days={7} device="all" />);
        expect((await screen.findByText(/生成于.*统计区间按业务时区/)).textContent).toContain("2026/09/30 20:00:00");
        expect(screen.getByText(/注册区间：/).textContent).toContain("2026/10/01 08:00:00");
        expect(screen.getByText(/当前到期时间范围：/).textContent).toContain("2026/10/01 08:00:00");
    } finally { setAdminDisplayTimeZone("business"); }
});
