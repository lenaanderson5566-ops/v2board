// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminLogFilters } from "./AdminLogFilters";
afterEach(cleanup);
it("restores applied filters and preserves the failed status", () => {
    const apply = vi.fn();
    render(
        <AdminLogFilters
            kind="login"
            onApply={apply}
            initialFilters={{
                keyword: "FastAI",
                is_success: "0",
                from: 1791849600,
            }}
        />,
    );
    expect(
        (screen.getByLabelText("日志关键词") as HTMLInputElement).value,
    ).toBe("FastAI");
    fireEvent.click(screen.getByText("查询"));
    expect(apply).toHaveBeenCalledWith({
        keyword: "FastAI",
        is_success: "0",
        from: 1791849600,
    });
});
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

it("uses the configured zone for filters without repeating it on labels", async () => {
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    const { AdminLogTimeZone, logTime } = await import("./admin-log-time");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const apply = vi.fn();
    const at = Date.parse("2026-10-19T00:00:00Z") / 1000;
    const view = render(<><AdminLogTimeZone /><AdminLogFilters kind="login" initialFilters={{from: at}} onApply={apply}/><span>{logTime(at)}</span></>);
    expect(screen.getAllByText(/Asia\/Kathmandu/)).toHaveLength(1);
    expect((screen.getByLabelText("日志开始时间") as HTMLInputElement).value).toBe("2026-10-19T05:45");
    expect(view.container.textContent).not.toMatch(/GMT|UTC/);
    fireEvent.click(screen.getByRole("button", {name:"查询"}));
    expect(apply).toHaveBeenCalledWith({from:at});
    configureTimeZone("Asia/Shanghai", true);
    setDisplayTimeZone(null);
});
