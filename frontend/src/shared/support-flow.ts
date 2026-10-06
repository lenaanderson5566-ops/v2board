import type { Row } from "./api";

export const supportTopics = [
    ["import", "配置导入"],
    ["connection", "连接问题"],
    ["payment", "支付问题"],
    ["account", "账号问题"],
    ["other", "其他问题"],
] as const;

export function unresolvedTicket(tickets: Row[]): Row | undefined {
    return tickets.find((ticket) => Number(ticket.status) === 0);
}

export function supportPayload(
    body: Row,
    translate: (text: string) => string,
): Row {
    const topic =
        supportTopics.find(([value]) => value === body.topic) ||
        supportTopics[4];
    const order = String(body.order_trade_no || "").trim();
    return {
        subject: `[${translate(topic[1])}] ${String(body.subject || "").trim()}`,
        level: body.level,
        message: `${order ? `${translate("关联订单")}: ${order}\n\n` : ""}${String(body.message || "").trim()}`,
    };
}
