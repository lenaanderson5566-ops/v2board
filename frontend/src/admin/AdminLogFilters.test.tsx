// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminLogFilters } from "./AdminLogFilters";
afterEach(cleanup);
it("submits filters together, preserves failed login and resets", () => {
    const apply = vi.fn();
    render(<AdminLogFilters kind="login" onApply={apply} />);
    fireEvent.change(screen.getByLabelText("日志关键词"), {
        target: { value: " FastAI " },
    });
    fireEvent.change(screen.getByLabelText("日志登录结果"), {
        target: { value: "0" },
    });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("查询"));
    expect(apply).toHaveBeenLastCalledWith({
        keyword: "FastAI",
        is_success: "0",
    });
    fireEvent.click(screen.getByText("重置"));
    expect(apply).toHaveBeenLastCalledWith({});
});
it("rejects reversed ranges without sending a query", () => {
    const apply = vi.fn();
    render(<AdminLogFilters kind="subscribe" onApply={apply} />);
    fireEvent.change(screen.getByLabelText("日志开始时间"), {
        target: { value: "2026-10-13T12:00" },
    });
    fireEvent.change(screen.getByLabelText("日志结束时间"), {
        target: { value: "2026-10-12T12:00" },
    });
    fireEvent.click(screen.getByText("查询"));
    expect(screen.getByRole("alert").textContent).toContain(
        "结束时间不能早于开始时间",
    );
    expect(apply).not.toHaveBeenCalled();
});
