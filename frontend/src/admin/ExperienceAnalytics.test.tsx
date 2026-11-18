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
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()),
    readRequest: api.request,
    request: api.request,
}));
import { ExperienceAnalytics, type ExperienceReport } from "./ExperienceAnalytics";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
const at = "2026-10-01T00:00:00Z";
function fixture(): ExperienceReport {
    return {
        available: true,
        enabled: true,
        retentionDays: 30,
        effectiveFrom: at,
        rows: [
            {
                page: "subscribe",
                event: "copy_failed",
                samples: 5,
                sessions: 3,
                p75Upper: null,
                p95Upper: null,
            },
            {
                page: "subscribe",
                event: "cls",
                samples: 4,
                sessions: 3,
                p75Upper: 100,
                p95Upper: 250,
            },
        ],
    };
}

it("prioritizes affected sessions and tail performance without treating click counts as outcomes", async () => {
    const data = fixture();
    Object.assign(data, { observedSessions: 20, affectedSessions: 12, to: at, timeZone: "Asia/Shanghai" });
    data.rows.push(
        { page: "payment", event: "api_error", samples: 90, sessions: 2, p75Upper: null, p95Upper: null },
        { page: "confirmation", event: "network_error", samples: 20, sessions: 12, p75Upper: null, p95Upper: null },
        { page: "subscribe", event: "download", samples: 100, sessions: 20, p75Upper: null, p95Upper: null },
        { page: "payment", event: "payment_open", samples: 8, sessions: 3, p75Upper: null, p95Upper: null },
    );
    api.request.mockResolvedValue({ data: { experience: data } });
    render(<ExperienceAnalytics days={7} device="mobile" />);
    expect(await screen.findByText(/不能代表全部访客/)).toBeTruthy();
    expect(screen.getByText(/付费转化以订单记录为准/)).toBeTruthy();
    expect(screen.getByText(/个已采集会话上报过异常/).textContent).toMatch(/12 \/ 20.*60%/);
    expect(screen.getByText(/业务时区 Asia\/Shanghai/).textContent).toContain("2026/10/01 08:00:00");
    expect(screen.queryByRole("heading", { name: "注册到首次使用 · 7 日观察窗" })).toBeNull();
    expect(screen.getAllByRole("row")[1].textContent).toMatch(/网络错误.*12/);
    expect(screen.queryByText("下载点击")).toBeNull();
    expect(screen.queryByText("payment_open")).toBeNull();
    expect(screen.queryByText("点击前往付款")).toBeNull();
    expect(screen.queryByText("平均值")).toBeNull();
    expect(screen.getByText("P95 桶上界")).toBeTruthy();
    expect(screen.getByText("0.25")).toBeTruthy();
    expect(api.request.mock.calls[0][0]).toBe("test-admin/analytics/journey?days=7&device=mobile&view=experience");
    fireEvent.click(screen.getByRole("button", { name: "刷新体验报表" }));
    await waitFor(() => expect(api.request.mock.calls.length).toBe(2));
});

it("distinguishes zero sampled sessions from sampled sessions reporting no issues", async () => {
    const data = { ...fixture(), rows: [], observedSessions: 0, affectedSessions: 0 };
    api.request.mockResolvedValue({ data: { experience: data } });
    const view = render(<ExperienceAnalytics days={7} device="tablet" />);
    expect(await screen.findByText(/没有已采集会话/)).toBeTruthy();
    expect(screen.queryByText(/0%/)).toBeNull();
    api.request.mockResolvedValue({ data: { experience: { ...data, observedSessions: 10 } } });
    view.rerender(<ExperienceAnalytics days={7} device="desktop" />);
    expect((await screen.findByText(/个已采集会话上报过异常/)).textContent).toMatch(/0 \/ 10.*0%/);
    expect(screen.getByText(/未收到这些异常/)).toBeTruthy();
});

it("reports missing measurement tables and retries failed device requests", async () => {
    api.request.mockResolvedValue({ data: { experience: { available: false, rows: [] } } });
    const view = render(<ExperienceAnalytics days={7} device="desktop" />);
    expect(await screen.findByText(/体验统计表尚未安装/)).toBeTruthy();
    api.request.mockRejectedValueOnce(new Error("体验报表读取失败"));
    view.rerender(<ExperienceAnalytics days={90} device="mobile" />);
    expect(await screen.findByText("体验报表读取失败")).toBeTruthy();
    api.request.mockResolvedValue({ data: { experience: fixture() } });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("复制失败")).toBeTruthy();
    expect(api.request.mock.calls.at(-1)?.[0]).toBe("test-admin/analytics/journey?days=90&device=mobile&view=experience");
});

it("shows the experience window in the business zone despite a different admin display zone", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Shanghai", true);
    setAdminDisplayTimeZone("America/New_York");
    const experience = { ...fixture(), timeZone: "Asia/Shanghai", to: at };
    api.request.mockResolvedValue({ data: { experience } });
    try {
        render(<ExperienceAnalytics days={7} device="all" />);
        expect((await screen.findByText(/查询范围/)).textContent).toContain("2026/10/01 08:00:00");
    } finally { setAdminDisplayTimeZone("business"); }
});
