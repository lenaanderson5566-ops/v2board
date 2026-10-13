// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.hoisted(() => { window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any; });
import { PaymentCallbackHistory } from "./PaymentCallbackHistory";
afterEach(cleanup);
it("labels unassociated channel events separately and links request IDs", () => {
    render(
        <PaymentCallbackHistory
            history={{
                available: true,
                events: [],
                channelEvents: [
                    {
                        id: 1,
                        provider: "PaytaroQR",
                        stage: "verification",
                        result: "failed",
                        reason: "verify error",
                        created_at: 1791849600,
                        request_id: "12345678-1234-4234-8234-123456789abc",
                    },
                ],
            }}
        />,
    );
    expect(screen.getByText("暂无订单关联回调记录。")).toBeTruthy();
    expect(screen.getByText(/未确认属于本订单/)).toBeTruthy();
    expect(screen.getByText("验签或通知内容校验失败")).toBeTruthy();
    expect(
        screen
            .getByText("12345678-1234-4234-8234-123456789abc")
            .getAttribute("href"),
    ).toContain("#/system-log?request_id=");
});
