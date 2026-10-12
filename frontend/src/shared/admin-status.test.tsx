// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminStatus, adminStatusCell } from "./admin-status";
afterEach(cleanup);
it("distinguishes false and string zero from unknown login results", () => {
    const { rerender } = render(<AdminStatus value="0" login />);
    expect(screen.getByText("登录失败").getAttribute("data-tone")).toBe("danger");
    rerender(<AdminStatus value={null} login />);
    expect(screen.getByText("未知").getAttribute("data-tone")).toBe("neutral");
    rerender(<AdminStatus value={true} login />);
    expect(screen.getByText("登录成功").getAttribute("data-tone")).toBe("success");
});
it("uses contextual enums and preserves interactive renderers", () => {
    render(<>{adminStatusCell("status", "订单状态", 0)}{adminStatusCell("status", "原请求结果", "failed")}{adminStatusCell("is_enabled", "启用", "0")}{adminStatusCell("http_status", "状态码", 500)}{adminStatusCell("enabled", "启用", 1, <button>切换</button>)}</>);
    expect(screen.getByText("待支付").getAttribute("data-tone")).toBe("warning");
    expect(screen.getByText("失败").getAttribute("data-tone")).toBe("danger");
    expect(screen.getByText("已停用").getAttribute("data-tone")).toBe("neutral");
    expect(screen.getByText("500").getAttribute("data-tone")).toBe("danger");
    expect(screen.getByRole("button", { name: "切换" })).toBeTruthy();
});
