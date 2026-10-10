// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
const read = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ boot: { mode: "user" }, readRequest: read, request: vi.fn() }));
vi.mock("./i18n", () => ({ default: { addResourceBundle: vi.fn() }, tx: (s: string) => s, locale: () => "zh-CN" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./browser-session", () => ({ browserSessionKey: () => "test" }));
import { useData } from "./ui";
afterEach(() => { cleanup(); read.mockReset(); });
it("keeps payment methods stable during redirect events but allows manual retry", async () => {
    read.mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useData("user/order/getPaymentMethod", undefined, false, { refreshOnEvents: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
        window.dispatchEvent(new Event("data-changed"));
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(read).toHaveBeenCalledTimes(1);
    act(() => result.current.reload());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});
it("preserves automatic refresh for other data", async () => {
    read.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useData("user/order/fetch"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => window.dispatchEvent(new Event("data-changed")));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});

