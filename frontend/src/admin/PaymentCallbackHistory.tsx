import { date, type Row } from "../shared/api";
import { Table } from "../shared/ui";

const stages: Record<string, string> = {
    preflight: "站内检查",
    provider: "支付接口处理",
    gateway: "网关下单",
    channel: "支付渠道",
    verification: "验签",
    settlement: "订单处理",
};
const results: Record<string, string> = {
    blocked: "拦截重试",
    settled: "站内付款处理完成",
    qr_ready: "已返回二维码",
    redirect_ready: "已返回跳转链接",
    action_ready: "已返回支付入口",
    pending: "等待确认",
    handled: "处理完成",
    acknowledged: "已确认通知（无需结算）",
    failed: "失败",
};
const reasons: Record<string, string> = {
    order_closed: "订单已关闭或已支付",
    invalid_amount: "订单金额无效",
    channel_unavailable: "渠道不可用或配置已变更",
    quote_changed: "报价已变动，请重新确认金额",
    quote_expired: "订单折抵报价已失效",
    in_flight: "上一笔支付尝试尚未确认，请先核对订单",
    request_key_conflict: "同一支付请求使用了不同的渠道或报价",
    invalid_config: "支付接口配置无效，请核对接口地址及必填项",
    missing_credentials: "商户凭证缺失，请核对渠道配置",
    currency_mismatch: "渠道源币种与订单支付币种不一致",
    gateway_result_unknown: "网关结果未知，请到商户后台核对订单",
    dns_failed: "网关域名解析失败",
    connection_failed: "无法连接网关",
    tls_failed: "网关 TLS 握手或证书校验失败",
    gateway_timeout: "等待网关响应超时，请到商户后台核对订单",
    transport_failed: "网关通信异常，请到商户后台核对订单",
    gateway_http_error: "网关返回 HTTP 错误",
    invalid_response: "网关返回格式无法识别",
    gateway_rejected: "网关拒绝下单，请核对网关错误码及商户配置",
    missing_payment_action: "网关响应缺少有效的支付入口或交易号",
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

function requestLink(id: string) {
    return <a href={`#/system-log?request_id=${encodeURIComponent(id)}`}>{id}</a>;
}

function diagnosis(row: Row): string {
    return reasons[row.reason] || results[row.result] || "—";
}

const columns: [string, string, ((row: Row) => React.ReactNode)?][] = [
    ["created_at", "时间", (r) => date(r.created_at)],
    ["provider", "支付接口", (r) => r.provider ? `${r.provider}${r.payment_id ? ` · #${r.payment_id}` : ""}` : "—"],
    ["stage", "阶段", (r) => stages[r.stage] || r.stage],
    ["result", "结果", (r) => results[r.result] || r.result],
    ["reason", "说明", (r) => r.reason ? diagnosis(r) : "—"],
    [
        "request_id", "请求 ID", (r) => <>
            {r.request_id ? requestLink(r.request_id) : "—"}
            {r.previous_request_id && <div>前一笔 {requestLink(r.previous_request_id)}</div>}
        </>,
    ],
];

const responseTypes: Record<string, string> = {
    object: "对象", array: "数组", string: "字符串", number: "数值", boolean: "布尔值",
    null: "空值", empty: "空字符串", markup: "HTML 或 XML", missing: "缺失",
    masked: "已遮蔽", invalid_url: "链接无效，已遮蔽",
};

function GatewayResponse({ response, provider }: { response: Row; provider?: string }) {
    const format = responseTypes[response.format] || "未知";
    return <details>
        <summary>查看脱敏响应</summary>
        <p>响应类型：{format}</p>
        {response.messages?.length > 0 && <p>网关提示：{response.messages.join("、")}</p>}
        {response.unrecognized_message && <p>网关返回了未识别的提示，原文已遮蔽。</p>}
        {provider === "EPayQrcode" && <p>易支付下单成功时，三个支付入口字段中有一个可用即可。</p>}
        <ul>
            {Object.entries(response.fields ?? {}).map(([field, kind]) => (
                <li key={field}>
                    <code>{field}</code> · {responseTypes[String(kind)] || "未知"}
                    {response.codes?.[field] != null && <> · {response.codes[field]}</>}
                </li>
            ))}
            {Object.entries(response.other_fields ?? {}).map(([path, count]) => (
                <li key={path}>{path === "$" ? "根对象" : <code>{path}</code>} · {String(count)} 个其他字段已隐藏</li>
            ))}
        </ul>
    </details>;
}

const gatewayColumn: (typeof columns)[number] = ["gateway_host", "网关信息", (r) => <>
    {[
        r.gateway_host,
        r.gateway_http_status ? `HTTP ${r.gateway_http_status}` : null,
        r.gateway_code != null ? `网关码 ${r.gateway_code}` : null,
        r.gateway_order ? `网关单号 ${r.gateway_order}` : null,
        r.gateway_actions ? `返回字段 ${r.gateway_actions}` : null,
        r.duration_ms != null ? `${r.duration_ms} ms` : null,
    ].filter(Boolean).join(" · ") || "—"}
    {r.gateway_response && <GatewayResponse response={r.gateway_response} provider={r.provider} />}
</>];

export function PaymentCallbackHistory({ history, attempts, paidAt }: { history?: Row; attempts?: Row; paidAt?: number }) {
    const attemptEvents: Row[] = attempts?.events || [];
    const callbackEvents: Row[] = history?.events || [];
    const timeline = [
        ...callbackEvents.map((event): Row => ({ ...event, type: "callback" })),
        ...attemptEvents.map((event): Row => ({ ...event, type: "attempt" })),
    ].sort((a, b) => b.created_at - a.created_at);
    const latest = timeline[0];
    const origin = latest?.previous_request_id
        ? attemptEvents.find((event) => event.request_id === latest.previous_request_id)
        : undefined;
    return (
        <section>
            <h3>支付诊断</h3>
            {paidAt ? <p><strong>站点已记录付款</strong> · {date(paidAt)}</p> : null}
            {latest && <p><strong>最近进展</strong> · {diagnosis(latest)}{origin && <> · 前一笔：{diagnosis(origin)}</>}</p>}
            <p className="muted">
                各显示最近 20 条发起和回调记录。脱敏响应仅记录功能上线后的下单请求，到账以订单状态及支付时间为准。
            </p>
            {timeline.length > 0 && <Table data={timeline} columns={[...columns, gatewayColumn]} />}
            {!attempts?.available ? <p className="muted">支付发起诊断尚未就绪，请确认已执行数据库迁移。</p>
                : !attemptEvents.length && <p>暂无支付发起记录，仅记录功能上线后的请求。</p>}
            {!history?.available ? <p className="muted">回调诊断尚未就绪，请确认已执行数据库迁移。</p>
                : !callbackEvents.length && <p>暂无订单关联回调记录。</p>}
            {!!history?.channelEvents?.length && (
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

export function PaymentChannelFailures({ history }: { history: Row }) {
    if (!history.available) return <p>支付发起诊断尚未就绪，请确认已执行数据库迁移。</p>;
    if (!history.events.length) return <p>最近一小时没有记录到发起支付失败。</p>;

    return <>
        <p className="muted">最近一小时内的 20 条发起失败记录。</p>
        <Table data={history.events} columns={[
            ["trade_no", "订单号", (r) => r.trade_no ? <a href={`#/orders?trade_no=${encodeURIComponent(r.trade_no)}`}>{r.trade_no}</a> : "—"],
            ...columns.filter(([key]) => key !== "provider" && key !== "result"),
            gatewayColumn,
        ]} />
    </>;
}
