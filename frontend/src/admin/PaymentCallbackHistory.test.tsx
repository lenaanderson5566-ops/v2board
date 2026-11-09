// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.hoisted(() => { window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any; });
import { PaymentCallbackHistory, PaymentChannelFailures } from "./PaymentCallbackHistory";
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

it("links a blocked retry to its original gateway failure", () => {
    const requestId = "12345678-1234-4234-8234-123456789abc";
    render(<PaymentCallbackHistory history={{ available: true, events: [] }} attempts={{ available: true, events: [
        { id: 2, stage: "preflight", result: "blocked", reason: "in_flight", previous_request_id: requestId, created_at: 1791849610 },
        { id: 1, stage: "gateway", result: "failed", reason: "gateway_timeout", request_id: requestId, created_at: 1791849600, gateway_host: "gateway.example" },
    ] }} />);
    expect(screen.getByText(/最近进展/).parentElement?.textContent).toContain("前一笔：等待网关响应超时");
    expect(screen.getAllByRole("link", { name: requestId })).toHaveLength(2);
    expect(screen.getByText("gateway.example")).toBeTruthy();
});

it("links a channel failure to the matching order search", () => {
    render(<PaymentChannelFailures history={{ available: true, events: [
        { id: 1, stage: "preflight", result: "failed", reason: "missing_credentials", trade_no: "fixture-order", created_at: 1791849600 },
    ] }} />);
    expect(screen.getByRole("link", { name: "fixture-order" }).getAttribute("href")).toBe("#/orders?trade_no=fixture-order");
    expect(screen.getByText("商户凭证缺失，请核对渠道配置")).toBeTruthy();
});

it("shows redacted gateway fields and the error summary from a channel failure", () => {
    render(<PaymentChannelFailures history={{ available: true, events: [{
        id: 1, stage: "gateway", result: "failed", trade_no: "fixture-order", created_at: 1791849600,
        gateway_http_status: 200, gateway_response: { format: "object", fields: { code: "number", "data.trade_no": "missing", "data.pay_url": "masked" },
            codes: { code: 1 }, messages: ["商户 PID 缺失"], unrecognized_message: true, other_fields: { data: 1 } },
    }] }} />);
    expect(screen.queryByRole("button", { name: "查看原始诊断" })).toBeNull();
    screen.getByText("查看历史脱敏摘要").click();
    expect(screen.getByText("网关提示：商户 PID 缺失")).toBeTruthy();
    expect(screen.getByText("data.trade_no").parentElement?.textContent).toContain("缺失");
    expect(screen.getByText("data.pay_url").parentElement?.textContent).toContain("已遮蔽");
    expect(screen.getByText("code").parentElement?.textContent).toContain("数值 · 1");
    expect(screen.getByText("网关返回了未识别的提示，原文已遮蔽。")).toBeTruthy();
});
