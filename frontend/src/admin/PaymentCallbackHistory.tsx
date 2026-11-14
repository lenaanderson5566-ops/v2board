import { useId, useState } from "react";
import { admin, date, type Row } from "../shared/api";
import { StatusBadge, type StatusTone } from "../shared/StatusBadge";
import { Modal, State, Table, useData } from "../shared/ui";
import "./payment-diagnostics.css";

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
const resultTones: Record<string, StatusTone> = {
    blocked: "warning",
    settled: "success",
    qr_ready: "info",
    redirect_ready: "info",
    action_ready: "info",
    pending: "warning",
    handled: "success",
    acknowledged: "success",
    failed: "danger",
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
    saved_payment_action_unavailable: "站内未找到可恢复的二维码或付款链接，本次未向网关发起新请求",
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
    return <a className="payment-diagnostic-id" href={`#/system-log?request_id=${encodeURIComponent(id)}`}>{id}</a>;
}

function diagnosis(row: Row): string {
    if (row.reason === "saved_payment_action_unavailable"
        || (row.stage === "preflight" && row.reason === "missing_payment_action")) {
        const count = Number(row.recovery_miss_count);
        const message = reasons.saved_payment_action_unavailable;
        return Number.isSafeInteger(count) && count > 1
            ? `${message}（本订单共 ${count} 次，显示最近一次）`
            : message;
    }
    return reasons[row.reason] || results[row.result] || "—";
}

const columns: [string, string, ((row: Row) => React.ReactNode)?][] = [
    ["created_at", "时间", (r) => <span className="payment-diagnostic-time">{date(r.created_at)}</span>],
    ["provider", "支付接口", (r) => r.provider ? `${r.provider}${r.payment_id ? ` · #${r.payment_id}` : ""}` : "—"],
    ["stage", "阶段", (r) => stages[r.stage] || r.stage],
    ["result", "结果", (r) => <StatusBadge tone={resultTones[r.result]}>{results[r.result] || r.result}</StatusBadge>],
    ["reason", "说明", (r) => r.reason ? diagnosis(r) : "—"],
    [
        "request_id", "请求 ID", (r) => <div className="payment-diagnostic-requests">
            {r.request_id ? requestLink(r.request_id) : "—"}
            {r.previous_request_id && <div><span className="muted">前一笔</span> {requestLink(r.previous_request_id)}</div>}
        </div>,
    ],
];

const responseTypes: Record<string, string> = {
    object: "对象", array: "数组", string: "字符串", number: "数值", boolean: "布尔值",
    null: "空值", empty: "空字符串", markup: "HTML 或 XML", missing: "缺失",
    masked: "已遮蔽", invalid_url: "链接无效，已遮蔽",
};

function GatewayResponse({ response }: { response: Row }) {
    const format = responseTypes[response.format] || "未知";
    return <details className="payment-diagnostic-disclosure">
        <summary>查看历史脱敏摘要</summary>
        <p>响应类型：{format}</p>
        {response.messages?.length > 0 && <p>网关提示：{response.messages.join("、")}</p>}
        {response.unrecognized_message && <p>网关返回了未识别的提示，原文已遮蔽。</p>}
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

type DiagnosticKind = "attempt" | "callback";
type DiagnosticSections = { sections: { title: string; text: string }[] };

function RawPaymentDiagnostic({ kind, id, close }: {
    kind: DiagnosticKind;
    id: number | string;
    close: () => void;
}) {
    const diagnostic = useData<DiagnosticSections>(
        admin(`payment/diagnostics/${kind}/${encodeURIComponent(id)}`),
    );
    return <Modal title="原始支付诊断" variant="modal" className="admin-detail-dialog" close={close}>
        <div className="admin-detail-body">
            <State
                loading={diagnostic.loading}
                error={diagnostic.error ? "无法读取原始支付诊断。" : ""}
                retry={diagnostic.reload}
                retryAt={diagnostic.retryAt}
            >
                {diagnostic.data?.sections?.length ? diagnostic.data.sections.map((section, index) => (
                    <section key={index} className="admin-detail-section payment-diagnostic-raw-section">
                        <h3 className="admin-detail-section-head">{section.title}</h3>
                        <pre className="payment-diagnostic-text">{section.text}</pre>
                    </section>
                )) : <p>这条记录没有原始诊断。</p>}
            </State>
        </div>
    </Modal>;
}

function DiagnosticDetails({ event, kind }: { event: Row; kind: DiagnosticKind }) {
    const [open, setOpen] = useState(false);
    const gatewayFacts = [
        event.gateway_http_status ? `HTTP ${event.gateway_http_status}` : null,
        event.gateway_code != null ? `网关码 ${event.gateway_code}` : null,
        event.duration_ms != null ? `${event.duration_ms} ms` : null,
    ].filter(Boolean);
    const gatewayDetails = [
        event.gateway_order ? `网关单号 ${event.gateway_order}` : null,
        event.gateway_actions ? `返回字段 ${event.gateway_actions}` : null,
    ].filter(Boolean);
    const summary = event.gateway_host || gatewayFacts.length > 0 || gatewayDetails.length > 0;
    const hasRaw = event.has_raw_diagnostic === true && event.id != null;
    return <div className="payment-diagnostic-gateway">
        {event.gateway_host && <strong>{event.gateway_host}</strong>}
        {gatewayFacts.length > 0 && <ul className="payment-diagnostic-facts">
            {gatewayFacts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>}
        {gatewayDetails.map((detail) => <div key={detail}>{detail}</div>)}
        {hasRaw ? <>
            <button type="button" onClick={() => setOpen(true)}>查看原始诊断</button>
            {open && <RawPaymentDiagnostic kind={kind} id={event.id} close={() => setOpen(false)} />}
        </> : event.gateway_response ? <GatewayResponse response={event.gateway_response} /> : !summary && "—"}
    </div>;
}

const gatewayColumn: (typeof columns)[number] = ["gateway_host", "网关信息", (row) => (
    <DiagnosticDetails event={row} kind={row.type === "callback" ? "callback" : "attempt"} />
)];

export function PaymentCallbackHistory({ history, attempts, paidAt }: {
    history?: Row;
    attempts?: Row;
    paidAt?: number;
}) {
    const heading = useId();
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
        <section className="payment-diagnostics" aria-labelledby={heading}>
            <h3 id={heading}>支付诊断</h3>
            {(Boolean(paidAt) || latest) && <div className="payment-diagnostic-summary">
                {paidAt ? <div className="payment-diagnostic-summary-item">
                    <StatusBadge tone="success">站点已记录付款</StatusBadge>
                    <p>{date(paidAt)}</p>
                </div> : null}
                {latest && <div className="payment-diagnostic-summary-item">
                    <strong>最近进展</strong>
                    <p>{diagnosis(latest)}</p>
                    {origin && <p className="muted">前一笔：{diagnosis(origin)}</p>}
                </div>}
            </div>}
            <p className="muted">
                发起记录和回调记录各显示最近 20 条。本订单重复的站内付款恢复失败合并显示最近一次。原始诊断仅管理员可查看，从启用统一记录后开始保存。到账以订单状态及支付时间为准。
            </p>
            {timeline.length > 0 && <Table data={timeline} columns={[...columns, gatewayColumn]} />}
            {(!attempts?.available || !history?.available || !attemptEvents.length || !callbackEvents.length) && (
                <div className="payment-diagnostic-empty">
                    {!attempts?.available ? <p className="muted">支付发起诊断尚未就绪，请确认已执行数据库迁移。</p>
                        : !attemptEvents.length && <p>暂无支付发起记录，仅记录功能上线后的请求。</p>}
                    {!history?.available ? <p className="muted">回调诊断尚未就绪，请确认已执行数据库迁移。</p>
                        : !callbackEvents.length && <p>暂无订单关联回调记录。</p>}
                </div>
            )}
            {!!history?.channelEvents?.length && (
                <details className="payment-diagnostic-disclosure payment-diagnostic-channel-events">
                    <summary>
                        同渠道未关联事件（{history.channelEvents.length} 条）
                    </summary>
                    <p className="muted">
                        订单创建后、最近 24
                        小时内的渠道事件，未确认属于本订单，仅供排障参考。未通过验证的失败按渠道采样。
                    </p>
                    <Table data={history.channelEvents.map((event: Row) => ({ ...event, type: "callback" }))} columns={[...columns, gatewayColumn]} />
                </details>
            )}
        </section>
    );
}

export function PaymentChannelFailures({ history }: { history: Row }) {
    const attemptsHeading = useId();
    const callbacksHeading = useId();
    const attemptEvents: Row[] = history.events ?? [];
    const callbackEvents: Row[] | undefined = history.callbackEvents;
    const orderColumn: (typeof columns)[number] = [
        "trade_no", "订单号",
        (row) => row.trade_no ? <a className="payment-diagnostic-id" href={`#/orders?trade_no=${encodeURIComponent(row.trade_no)}`}>{row.trade_no}</a> : "—",
    ];
    return <>
        <section className="payment-diagnostics" aria-labelledby={attemptsHeading}>
            <h3 id={attemptsHeading}>发起支付失败</h3>
            {!history.available ? <p>支付发起诊断尚未就绪，请确认已执行数据库迁移。</p>
                : attemptEvents.length > 0 ? <>
                    <p className="muted">最近一小时内最多 20 条发起失败记录。</p>
                    <Table data={attemptEvents} columns={[
                        orderColumn,
                        ...columns.filter(([key]) => key !== "provider" && key !== "result"),
                        gatewayColumn,
                    ]} />
                </> : <p>最近一小时没有记录到发起支付失败。</p>}
        </section>
        {callbackEvents && <section className="payment-diagnostics" aria-labelledby={callbacksHeading}>
            <h3 id={callbacksHeading}>支付回调</h3>
            {callbackEvents.length > 0 ? <>
                <p className="muted">最近一小时内最多 20 条回调诊断记录。未通过验证的失败按渠道采样。</p>
                <Table
                    data={callbackEvents.map((event) => ({ ...event, type: "callback" }))}
                    columns={[orderColumn, ...columns.filter(([key]) => key !== "provider"), gatewayColumn]}
                />
            </> : <p>最近一小时没有回调记录。</p>}
        </section>}
    </>;
}
