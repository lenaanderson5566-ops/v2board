// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
const read = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({
    boot: { mode: "user" },
    readRequest: read,
    request: vi.fn(),
}));
vi.mock("./i18n", () => ({
    default: { addResourceBundle: vi.fn() },
    tx: (s: string) => s,
    locale: () => "zh-CN",
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./browser-session", () => ({ browserSessionKey: () => "test" }));
import { useData } from "./ui";
afterEach(() => {
    cleanup();
    read.mockReset();
});
it("keeps payment methods stable during redirect events but allows manual retry", async () => {
    read.mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() =>
        useData("user/order/getPaymentMethod", undefined, false, {
            refreshOnEvents: false,
        }),
    );
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
it("clears old rows on query changes and ignores a late refresh", async () => {
    let old!: (value: any) => void;
    let next!: (value: any) => void;
    read.mockResolvedValueOnce({
        data: ["first"],
        total: 40,
        meta: { page: 1 },
    })
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    old = resolve;
                }),
        )
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    next = resolve;
                }),
        );
    const { result, rerender } = renderHook(
        ({ page }) => useData("items", { page }),
        { initialProps: { page: 1 } },
    );
    await waitFor(() => expect(result.current.data).toEqual(["first"]));
    act(() => result.current.reload());
    expect(result.current.data).toEqual(["first"]);
    rerender({ page: 2 });
    expect(result.current).toMatchObject({
        data: null,
        total: 0,
        meta: undefined,
    });
    await act(async () => old({ data: ["stale"], total: 40 }));
    expect(result.current.data).toBeNull();
    await act(async () => next({ data: ["second"], total: 1 }));
    expect(result.current.data).toEqual(["second"]);
});
it("clears data and pagination when a conditional request is disabled", async () => {
    read.mockResolvedValue({ data: [1], total: 9, meta: { page: 1 } });
    const { result, rerender } = renderHook(({ path }) => useData(path), {
        initialProps: { path: "items" },
    });
    await waitFor(() => expect(result.current.total).toBe(9));
    rerender({ path: "" });
    expect(result.current).toMatchObject({
        data: null,
        total: 0,
        loading: false,
        error: "",
        meta: undefined,
    });
});

it("keeps reload stable across requests and parent renders", async () => {
    read.mockResolvedValue({data: []});
    const {result, rerender} = renderHook(() => useData("example"));
    const reload = result.current.reload;
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    expect(result.current.reload).toBe(reload);
    act(() => reload());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(result.current.reload).toBe(reload);
});

it("coalesces focus and visibility resume events without suppressing data changes",async()=>{
    read.mockResolvedValue({data:[]});
    const {result}=renderHook(()=>useData("user/order/fetch"));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    act(()=>document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
    act(()=>window.dispatchEvent(new Event("focus")));
    expect(read).toHaveBeenCalledTimes(2);
    act(()=>window.dispatchEvent(new Event("data-changed")));
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(3));
});
