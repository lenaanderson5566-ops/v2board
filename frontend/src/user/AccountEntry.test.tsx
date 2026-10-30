// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    info: {
        data: { account_status: { state: "active" }, expired_at: null },
        reload: vi.fn(),
    },
}));
vi.mock("../shared/ui/data", () => ({
    useData: () => mocks.info,
    State: ({ children }: any) => children,
}));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("../shared/api", () => ({ date: () => "test expiry" }));
import { AccountEntry } from "./AccountEntry";
import { UserStatusGate } from "./UserStatusGate";
afterEach(cleanup);
describe("account entry", () => {
    it("guides new users to a plan without offering a subscription import action", () => {
        render(<AccountEntry state="new" />);
        expect(
            screen.getByRole("link", { name: "选择套餐" }).getAttribute("href"),
        ).toBe("#/plan");
        expect(
            screen.getByRole("link", { name: "使用文档" }).getAttribute("href"),
        ).toBe("#/knowledge");
        expect(screen.queryByRole("link", { name: "配置中心" })).toBeNull();
        expect(screen.getByText("确认与支付")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "一键导入" })).toBeNull();
    });
    it("preserves expired plan details and offers renewal and orders", () => {
        render(
            <AccountEntry
                state="expired"
                subscription={{
                    plan: { name: "Original plan" },
                    expired_at: 1,
                }}
            />,
        );
        expect(screen.getByText("Original plan")).toBeTruthy();
        expect(
            screen.getByRole("link", { name: /renew/ }).getAttribute("href"),
        ).toBe("#/plan");
        expect(
            screen.getByRole("link", { name: "账单" }).getAttribute("href"),
        ).toBe("#/order");
    });
    it("blocks the regular workspace and provides authenticated support and logout", () => {
        mocks.info.data.account_status.state = "banned";
        const logout = vi.fn();
        render(
            <UserStatusGate
                logout={logout}
                support={<div>ticket form</div>}
                fallbackFooter={<footer>privacy entry</footer>}
            >
                <div>normal workspace</div>
            </UserStatusGate>,
        );
        expect(screen.queryByText("normal workspace")).toBeNull();
        expect(screen.getByRole("contentinfo").textContent).toBe(
            "privacy entry",
        );
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "contactAdmin" }));
        expect(screen.getByText("ticket form")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
        expect(logout).toHaveBeenCalledOnce();
        mocks.info.data.account_status.state = "active";
    });
    it("leaves the workspace accessible during a valid subscription", () => {
        render(
            <UserStatusGate
                logout={vi.fn()}
                support={null}
                fallbackFooter={<footer>fallback privacy entry</footer>}
            >
                <div>normal workspace</div>
            </UserStatusGate>,
        );
        expect(screen.getByText("normal workspace")).toBeTruthy();
        expect(screen.queryByText("fallback privacy entry")).toBeNull();
    });
});
