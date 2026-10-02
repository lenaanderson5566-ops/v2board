// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    info: {
        data: { account_status: { state: "active" }, expired_at: null },
        reload: vi.fn(),
    },
}));
vi.mock("./ui", () => ({
    useData: () => mocks.info,
    State: ({ children }: any) => children,
}));
vi.mock("./i18n", () => ({ tx: (key: string) => key }));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./api", () => ({ date: () => "test expiry" }));
import { AccountEntry, UserStatusGate } from "./AccountEntry";
afterEach(cleanup);
describe("account entry", () => {
    it("guides new users to a plan without offering a subscription import action", () => {
        render(<AccountEntry state="new" />);
        expect(
            screen.getByRole("link", { name: "选择套餐" }).getAttribute("href"),
        ).toBe("#/plan");
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
            <UserStatusGate logout={logout} support={<div>ticket form</div>}>
                <div>normal workspace</div>
            </UserStatusGate>,
        );
        expect(screen.queryByText("normal workspace")).toBeNull();
        expect(screen.queryByRole("link", { name: "选择套餐" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "contactAdmin" }));
        expect(screen.getByText("ticket form")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
        expect(logout).toHaveBeenCalledOnce();
        mocks.info.data.account_status.state = "active";
    });
    it("leaves the workspace accessible during a valid subscription", () => {
        render(
            <UserStatusGate logout={vi.fn()} support={null}>
                <div>normal workspace</div>
            </UserStatusGate>,
        );
        expect(screen.getByText("normal workspace")).toBeTruthy();
    });
});
