// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
vi.mock("../shared/ui", () => ({
    Panel: ({ title, children }: { title: string; children: ReactNode }) => (
        <section>
            <h2>{title}</h2>
            {children}
        </section>
    ),
}));
import i18n from "../shared/i18n";
import { HelpGuides } from "./HelpGuides";
afterEach(cleanup);
beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
});
describe("self-service FAQ", () => {
    it("filters categories and searches answers", () => {
        const { container } = render(<HelpGuides />);
        fireEvent.click(screen.getByRole("button", { name: "用量与额度" }));
        expect(container.querySelectorAll("details")).toHaveLength(2);
        expect(
            screen
                .getByRole("button", { name: "用量与额度" })
                .getAttribute("aria-pressed"),
        ).toBe("true");
        fireEvent.change(screen.getByRole("searchbox"), {
            target: { value: " GB " },
        });
        expect(container.querySelectorAll("details")).toHaveLength(1);
        expect(screen.getByText("套餐流量与独立额度的区别")).toBeTruthy();
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "GiB" } });
        expect(container.querySelectorAll("details")).toHaveLength(1);
    });
    it("clears query and category when no results match", () => {
        const { container } = render(<HelpGuides />);
        fireEvent.click(screen.getByRole("button", { name: "账单与账户" }));
        fireEvent.change(screen.getByRole("searchbox"), {
            target: { value: "not-a-real-topic" },
        });
        expect(container.querySelectorAll("details")).toHaveLength(0);
        fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
        expect(container.querySelectorAll("details")).toHaveLength(8);
        expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
            "",
        );
    });
    it("links answers to current screens", () => {
        const { container } = render(<HelpGuides />);
        expect(
            [...container.querySelectorAll("details a")].map((a) =>
                a.getAttribute("href"),
            ),
        ).toEqual([
            "#/subscribe",
            "#/subscribe",
            "#/dashboard",
            "#/dashboard",
            "#/dashboard",
            "#/order",
            "#/order",
            "#/security",
        ]);
        expect(container.textContent).not.toContain("在总览中");
    });
    it("accepts a shared query without creating another search field", () => {
        const change = vi.fn();
        const view = render(<HelpGuides search="GB" onSearchChange={change} showSearch={false} />);
        expect(screen.queryByRole("searchbox")).toBeNull();
        expect(view.container.querySelectorAll("details")).toHaveLength(1);
        view.rerender(<HelpGuides search="unknown-topic" onSearchChange={change} showSearch={false} />);
        fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
        expect(change).toHaveBeenCalledWith("");
    });
    it("searches the selected language", async () => {
        await i18n.changeLanguage("en-US");
        const { container } = render(<HelpGuides />);
        fireEvent.change(
            screen.getByRole("searchbox", {
                name: "Search questions or keywords",
            }),
            { target: { value: "BANKED" } },
        );
        expect(container.querySelectorAll("details")).toHaveLength(1);
        expect(
            screen.getByText(
                "Usage reset schedule and expiry rules",
            ),
        ).toBeTruthy();
    });
});
