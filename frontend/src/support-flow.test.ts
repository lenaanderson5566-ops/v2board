import { describe, expect, it } from "vitest";
import { supportPayload, unresolvedTicket } from "./support-flow";
describe("self-service support", () => {
    it("continues open tickets even when older APIs serialize status as a string", () => {
        expect(
            unresolvedTicket([
                { id: 1, status: 1 },
                { id: 2, status: "0" },
            ])?.id,
        ).toBe(2);
        expect(unresolvedTicket([{ id: 1, status: 1 }])).toBeUndefined();
    });
    it("includes issue type and order context in the existing Laravel ticket contract", () => {
        expect(
            supportPayload(
                {
                    topic: "payment",
                    subject: "  未到账  ",
                    level: 0,
                    order_trade_no: " ABC123 ",
                    message: "  已付款  ",
                    unrelated: "ignore",
                },
                (label) => label,
            ),
        ).toEqual({
            subject: "[支付问题] 未到账",
            level: 0,
            message: "关联订单: ABC123\n\n已付款",
        });
    });
    it("allows issues without an order and translates the subject category", () => {
        expect(
            supportPayload(
                {
                    topic: "connection",
                    subject: "Error",
                    level: 1,
                    message: "Details",
                },
                () => "Connection issues",
            ),
        ).toEqual({
            subject: "[Connection issues] Error",
            level: 1,
            message: "Details",
        });
    });
});
