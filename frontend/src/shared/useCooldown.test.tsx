// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCooldown } from "./useCooldown";
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});
it("reenables sending at the deadline without another user interaction", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCooldown());
    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.remaining).toBe(60);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(59);
    act(() => vi.advanceTimersByTime(58999));
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.active).toBe(false);
});
it("cancels the pending timer when resetting or leaving the page", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCooldown());
    act(() => result.current.start());
    act(() => result.current.reset());
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.start());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
});
