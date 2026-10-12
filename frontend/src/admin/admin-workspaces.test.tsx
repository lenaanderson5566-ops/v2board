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
    expect(legacyAdminMenu.find(([key]) => key === "usage")?.[3]).toBe("日志");
    expect(legacyAdminMenu.find(([key]) => key === "online")?.[3]).toBe("用户");
    const groups = legacyAdminMenu
        .map((item) => item[3])
        .filter((group, index, all) => group !== all[index - 1]);
    expect(new Set(groups).size).toBe(groups.length);
});
