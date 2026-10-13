import { date, type Row } from "../shared/api";
import { Table } from "../shared/ui";

const stages: Record<string, string> = {
    channel: "支付渠道",
    verification: "验签",
    settlement: "订单处理",
};
const results: Record<string, string> = {
    handled: "处理完成",
    acknowledged: "已确认通知（无需结算）",
    failed: "失败",
};
const reasons: Record<string, string> = {
    "gate is not found": "支付接口不存在",
    "Payment channel not found": "支付渠道不存在",
    "gate is not enable": "支付渠道未启用",
    "verify error": "验签或通知内容校验失败",
    "handle error": "订单处理失败",
    "order is not found": "订单不存在",
    "channel mismatch": "支付渠道不匹配",
    "payment amount mismatch": "金额或币种不匹配",
    internal_error: "内部处理异常，请按请求 ID 排查",
};
export function PaymentCallbackHistory({ history }: { history?: Row }) {
    if (!history?.available)
        return (
            <p className="muted">回调诊断尚未就绪，请确认已执行数据库迁移。</p>
        );
    const columns: [string, string, ((row: Row) => React.ReactNode)?][] = [
        ["created_at", "时间", (r) => date(r.created_at)],
        ["provider", "支付接口"],
        ["stage", "阶段", (r) => stages[r.stage] || r.stage],
        ["result", "结果", (r) => results[r.result] || r.result],
        ["reason", "说明", (r) => reasons[r.reason] || r.reason || "—"],
        [
            "request_id",
            "请求 ID",
            (r) =>
                r.request_id ? (
                    <a
                        href={`#/system-log?request_id=${encodeURIComponent(r.request_id)}`}
                    >
                        {r.request_id}
                    </a>
                ) : (
                    "—"
                ),
        ],
    ];
    return (
        <section>
            <h3>支付回调诊断</h3>
            <p className="muted">
                最近 20
                条订单关联记录。处理完成包含重复通知，到账以订单状态及支付时间为准。仅记录功能上线后的回调。
            </p>
            {history.events?.length ? (
                <Table data={history.events} columns={columns} />
            ) : (
                <p>暂无订单关联回调记录。</p>
            )}
            {!!history.channelEvents?.length && (
                <details>
                    <summary>
                        同渠道未关联事件（{history.channelEvents.length} 条）
                    </summary>
                    <p className="muted">
                        订单创建后、最近 24
                        小时内的渠道事件，未确认属于本订单，仅供排障参考。
                    </p>
                    <Table data={history.channelEvents} columns={columns} />
                </details>
            )}
        </section>
    );
}
