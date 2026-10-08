// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("./payment-icons", () => ({ paymentIcons: [], paymentIconInitial: () => ({}), resolvePaymentIcon: () => "" }));
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (importOriginal) => ({
    ...await importOriginal<typeof import("../shared/api")>(),
    request: api.request,
    readRequest: api.request,
}));
import { Payments } from "./admin";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("enables and disables PaytaroQR using the existing backend show endpoint", async () => {
    let enabled = 0;
    api.request.mockImplementation(async (path: string, body: any) => {
        if (path === "test-admin/payment/fetch") return { data: [{ id: 7, name: "PaytaroQR", payment: "PaytaroQR", enable: enabled }] };
        if (path === "test-admin/payment/getPaymentMethods") return { data: ["PaytaroQR"] };
        if (path === "test-admin/payment/show") {
            expect(body).toEqual({ id: 7 });
            enabled = enabled ? 0 : 1;
            return { data: true };
        }
        throw new Error(`Unexpected endpoint: ${path}`);
    });
    render(<Payments />);
    fireEvent.click(await screen.findByRole("switch", { name: "PaytaroQR 启用" }));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(api.request.mock.calls.filter(([path]) => path.endsWith("/show"))).toHaveLength(2);
});

it("keeps the disabled state and displays activation errors", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("/fetch")) return { data: [{ id: 7, name: "PaytaroQR", payment: "PaytaroQR", enable: 0 }] };
        if (path.endsWith("/getPaymentMethods")) return { data: ["PaytaroQR"] };
        throw new Error("保存失败");
    });
    render(<Payments />);
    fireEvent.click(await screen.findByRole("switch", { name: "PaytaroQR 启用" }));
    expect((await screen.findByRole("alert")).textContent).toBe("保存失败");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});
