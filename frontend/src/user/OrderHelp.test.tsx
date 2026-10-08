// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const account = vi.hoisted(() => ({ data: { ticket_creation: "allowed" } as any, loading: false, error: "" }));
vi.mock("../shared/ui", () => ({ useData: () => account }));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
import { OrderHelp } from "./OrderHelp";
afterEach(() => { cleanup(); account.loading = false; account.error = ""; });
it("links eligible accounts to support with their exact order reference", () => {
    account.data = { ticket_creation: "allowed" };
    render(<OrderHelp tradeNo="order/a b" />);
    expect(screen.getByRole("link", { name: "此订单需要帮助？" }).getAttribute("href"))
        .toBe("#/ticket/order/order%2Fa%20b");
});
it.each(["purchase_required", "closed", undefined])("offers documentation for policy %s", (policy) => {
    account.data = { ticket_creation: policy };
    render(<OrderHelp tradeNo="order" />);
    expect(screen.getByRole("link", { name: "帮助中心" }).getAttribute("href")).toBe("#/knowledge");
    expect(screen.queryByRole("link", { name: "此订单需要帮助？" })).toBeNull();
});
it.each(["loading", "error"])("does not infer ticket permission while account state is %s", (state) => {
    account.data = { ticket_creation: "allowed" };
    account.loading = state === "loading";
    account.error = state === "error" ? "Unavailable" : "";
    render(<OrderHelp tradeNo="order" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("#/knowledge");
});
