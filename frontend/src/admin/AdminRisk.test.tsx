// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RiskOverview } from "./AdminRisk";

const { readRequest, request } = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", opsPath: "test-ops" } as typeof window.FASTAI;
    return { readRequest: vi.fn(), request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()), readRequest, request,
}));

afterEach(() => {
    cleanup();
    readRequest.mockReset();
    request.mockReset();
});

it("keeps the pending queue across reporting windows and refreshes both views after review", async () => {
    let pending = true;
    const hit = { id: 7, user_id: 4, email: "review@example.test", rule_name: "高拉取低流量", scene: "subscribe", hit_at: 1793000000, payload: {} };
    readRequest.mockImplementation(async (path: string) => {
        if (path.includes("review_queue")) return { data: pending ? [hit] : [], total: pending ? 1 : 0 };
        return { data: {
            review_queue: { total: pending ? 1 : 0, accounts: pending ? 1 : 0, oldest_at: pending ? hit.hit_at : null },
            blacklist: { ip: 0, ua: 0, trend: [] },
            rules: [],
        } };
    });
    request.mockImplementation(async () => { pending = false; return { data: true }; });

    render(<RiskOverview />);
    expect(await screen.findByText("1 条待复核")).toBeTruthy();
    expect(readRequest.mock.calls.some(([path]) => path.includes("review_queue"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "打开待复核队列" }));
    const review = await screen.findByRole("button", { name: "查看证据" });
    expect(within(review.closest("td")!).getByText("待处理")).toBeTruthy();
    expect(readRequest).toHaveBeenCalledWith("test-ops/log/rule-hit/fetch?review_queue=1&current=1&page_size=10", undefined, false);

    fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
    await waitFor(() => expect(readRequest).toHaveBeenCalledWith("test-ops/risk/summary/fetch?window=7d&view=dashboard", undefined, false));
    expect(screen.getByRole("button", { name: "查看证据" })).toBe(review);
    fireEvent.click(review);
    const dialog = await screen.findByRole("dialog", { name: "命中证据与人工复核" });
    expect(within(dialog).getByText(/仅针对当前原始记录/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("复核状态"), { target: { value: "confirmed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存复核" }));
    expect(await screen.findByText("0 条待复核")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "查看证据" })).toBeNull());
    expect(request).toHaveBeenCalledWith("test-ops/log/rule-hit/review", { id: 7, state: "confirmed", note: "" });
});

it("distinguishes actual blacklist requests from rules and explains the review sample", async () => {
    readRequest.mockResolvedValue({ data: {
        review_queue: { total: 0, accounts: 0, oldest_at: null },
        blacklist: { ip: 12, ua: 4, trend: [{ at: 1793000000, ip: 12, ua: 4 }] },
        rules: [
            { name: "高拉取低流量", hits: 18, accounts: 2, confirmed: 2, false_positives: 1 },
            { name: "订阅高频拉取", hits: 8, accounts: 1, confirmed: 0, false_positives: 0 },
        ],
    } });
    render(<RiskOverview />);
    expect((await screen.findByText("IP 黑名单拦截")).parentElement?.textContent).toContain("12");
    expect(screen.getByText("UA 黑名单拦截").parentElement?.textContent).toContain("4");
    expect(screen.getByText(/1 \/ 3/)).toBeTruthy();
    expect(screen.getByText("暂无判定")).toBeTruthy();
    expect(screen.getByRole("link", { name: "核对规则与阈值" }).getAttribute("href")).toBe("#/risk");
    expect(screen.getByRole("link", { name: "查看订阅请求与访问质量" }).getAttribute("href")).toBe("#/access-logs-subscriptions");
    expect(screen.queryByText("启用规则")).toBeNull();
    expect(screen.queryByRole("heading", { name: "近期风控事件" })).toBeNull();
});
