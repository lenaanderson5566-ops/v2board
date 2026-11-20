// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RiskOverview } from "./AdminRisk";
import { ResourcePage } from "./ResourcePage";
import { resources } from "./admin-resources";

const { readRequest, request } = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as typeof window.FASTAI;
    return { readRequest: vi.fn(), request: vi.fn() };
});
vi.mock("../shared/api", async (original) => ({
    ...(await original<typeof import("../shared/api")>()), readRequest, request,
}));

beforeEach(() => { readRequest.mockResolvedValue({ data: null }); });
afterEach(() => {
    cleanup();
    readRequest.mockReset();
    request.mockReset();
    sessionStorage.clear();
    localStorage.clear();
});

it("reviews only selected pending originals and keeps the conclusion available for retry", async () => {
    const hit = (id: number, state?: string) => ({
        id, rule_name: `规则 ${id}`, risk_level: "low", payload: state ? { review: { state } } : {},
    });
    let complete = false;
    readRequest.mockImplementation(async (path: string) => {
        const params = new URLSearchParams(path.split("?")[1]);
        if (params.get("grouped") === "1") return { data: [{ ...hit(99), hit_count: 34 }], total: 1 };
        return { data: complete ? [] : [hit(1), hit(2, "legacy_unknown"), hit(3, "confirmed")], total: complete ? 0 : 3 };
    });
    render(<ResourcePage resource={resources["access-logs-risk"]} />);
    await screen.findByText("规则 99");
    expect(screen.queryByRole("button", { name: "批量复核" })).toBeNull();
    fireEvent.change(screen.getByLabelText("风险等级"), { target: { value: "low" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    fireEvent.click(screen.getByRole("button", { name: "待复核原始记录" }));
    const all = await screen.findByLabelText("选择本页待复核记录");
    expect(readRequest.mock.calls.at(-1)?.[0]).toContain("risk_level=low");
    expect(readRequest.mock.calls.at(-1)?.[0]).toContain("review_state=pending");
    expect(screen.getByLabelText("选择命中记录 #3")).toHaveProperty("disabled", true);
    fireEvent.click(all);
    expect(screen.getByText("已选 2 条")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批量复核" }));
    let dialog = within(screen.getByRole("dialog", { name: "批量复核" }));
    expect(dialog.getByRole("button", { name: "确认复核" })).toHaveProperty("disabled", true);
    fireEvent.click(dialog.getByRole("button", { name: "取消" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "批量复核" }));
    dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("复核结论"), { target: { value: "ignored" } });
    fireEvent.change(dialog.getByLabelText("统一备注"), { target: { value: "已核对" } });
    request.mockRejectedValueOnce(new Error("连接中断"));
    fireEvent.click(dialog.getByRole("button", { name: "确认复核" }));
    await dialog.findByText("连接中断");
    expect(dialog.getByLabelText("统一备注")).toHaveProperty("value", "已核对");
    let finish!: () => void;
    request.mockImplementationOnce(() => new Promise(resolve => {
        finish = () => { complete = true; resolve({ data: { updated: 1, skipped: 1 } }); };
    }));
    const form = dialog.getByLabelText("复核结论").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("test-admin/ops/log/rule-hit/review", {
        ids: [1, 2], state: "ignored", note: "已核对",
    });
    finish();
    await screen.findByText(/已更新 1 条记录，跳过 1 条/);
    await waitFor(() => expect(screen.queryByLabelText("选择命中记录 #1")).toBeNull());
});

it("clears a previous page's risk hit selection before another page can be reviewed", async () => {
    readRequest.mockImplementation(async (path: string) => {
        const params = new URLSearchParams(path.split("?")[1]);
        const id = params.get("current") === "2" ? 21 : 1;
        return { data: [{ id, rule_name: `规则 ${id}`, payload: {} }], total: 21 };
    });
    render(<ResourcePage resource={resources["access-logs-risk"]} />);
    fireEvent.click(screen.getByRole("button", { name: "待复核原始记录" }));
    fireEvent.click(await screen.findByLabelText("选择命中记录 #1"));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByLabelText("选择命中记录 #21")).toHaveProperty("checked", false);
    expect(screen.getByRole("button", { name: "批量复核" })).toHaveProperty("disabled", true);
    expect(request).not.toHaveBeenCalled();
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
    expect(readRequest).toHaveBeenCalledWith("test-admin/ops/log/rule-hit/fetch?review_queue=1&current=1&page_size=10", undefined, false);

    fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
    await waitFor(() => expect(readRequest).toHaveBeenCalledWith("test-admin/ops/risk/summary/fetch?window=7d", undefined, false));
    expect(screen.getByRole("button", { name: "查看证据" })).toBe(review);
    fireEvent.click(review);
    const dialog = await screen.findByRole("dialog", { name: "命中证据与人工复核" });
    expect(within(dialog).getByText(/仅针对当前原始记录/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("复核状态"), { target: { value: "confirmed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存复核" }));
    expect(await screen.findByText("0 条待复核")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "查看证据" })).toBeNull());
    expect(request).toHaveBeenCalledWith("test-admin/ops/log/rule-hit/review", { id: 7, state: "confirmed", note: "" });
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
