import { e } from "./experience-copy";
import { tx, locale, languages } from "./i18n";
import { SubscriptionImport } from "./SubscriptionImport";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe, StripeCardElement } from "@stripe/stripe-js";
import {
    ArrowUpRight,
    Copy,
    Check,
    Download,
    ExternalLink,
} from "lucide-react";
import {
    boot,
    request,
    rows,
    query,
    money,
    bytes,
    date,
    navigate,
    type Row,
} from "./api";
import {
    useData,
    State,
    Panel,
    Metric,
    Table,
    Empty,
    Html,
    Editor,
    Modal,
    Reload,
    Pager,
    type Field,
} from "./ui";
const periods: Record<string, string> = {
    month_price: "月付",
    quarter_price: "季付",
    half_year_price: "半年付",
    year_price: "年付",
    two_year_price: "两年付",
    three_year_price: "三年付",
    onetime_price: "一次性",
    reset_price: "流量重置",
};
const statuses = ["待支付", "开通中", "已取消", "已完成", "已折抵"];
function CopyValue({
    value,
    label = tx("复制"),
}: {
    value: string;
    label?: string;
}) {
    const [copied, setCopied] = useState(false),
        [error, setError] = useState("");
    return (
        <>
            <button
                onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(value);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    } catch {
                        setError(tx("复制失败，请手动复制链接"));
                    }
                }}
            >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? tx("已复制") : label}
            </button>
            {error && <span role="alert">{error}</span>}
        </>
    );
}
export function UserDashboard() {
    const [more, setMore] = useState(false);
    const info = useData("user/info"),
        sub = useData("user/getSubscribe"),
        notice = useData<Row[]>("user/notice/fetch");
    const user = info.data || {},
        s = sub.data || {},
        used = Number(user.u || 0) + Number(user.d || 0),
        percent = user.transfer_enable
            ? Math.min(100, (used / user.transfer_enable) * 100)
            : 0;
    return (
        <State {...info} retry={info.reload}>
            <div className="dashboard-welcome">
                <div>
                    <h2>{e("connectionHelp")}</h2>
                    <p className="muted">{e("connectionDetail")}</p>
                </div>
                <a className="button" href="#/knowledge">
                    {tx("使用文档")}
                    <ArrowUpRight size={16} />
                </a>
            </div>
            <div className="split">
                <Panel
                    title={tx("我的订阅")}
                    actions={
                        <a className="button" href="#/plan">
                            {tx("购买订阅")}
                            <ArrowUpRight size={15} />
                        </a>
                    }
                >
                    <State {...sub} retry={sub.reload}>
                        <div className="pad">
                            <h3>{s.plan?.name || tx("尚未订阅套餐")}</h3>
                            <div className="progress">
                                <i style={{ width: percent + "%" }} />
                            </div>
                            <div className="muted">
                                {tx("已使用")}
                                {percent.toFixed(1)}% · {bytes(used)} /{" "}
                                {bytes(user.transfer_enable)}
                            </div>
                            {s.subscribe_url && (
                                <div className="actions space">
                                    <SubscriptionImport url={s.subscribe_url} />
                                    <CopyValue
                                        value={s.subscribe_url}
                                        label={tx("复制订阅链接")}
                                    />
                                    <a className="button" href="#/traffic">
                                        {e("usage")}
                                    </a>
                                </div>
                            )}
                            <dl className="subscription-facts">
                                <div>
                                    <dt>{tx("订阅到期")}</dt>
                                    <dd>
                                        {!s.plan
                                            ? e("noPlan")
                                            : s.expired_at
                                              ? new Date(
                                                    s.expired_at * 1000,
                                                ).toLocaleDateString(locale())
                                              : tx("长期有效")}
                                    </dd>
                                </div>
                                <div>
                                    <dt>{e("deviceLimit")}</dt>
                                    <dd>{s.device_limit || "—"}</dd>
                                </div>
                            </dl>
                        </div>
                    </State>
                </Panel>
                <Panel title={tx("最新公告")}>
                    <State {...notice} retry={notice.reload}>
                        {notice.data?.length ? (
                            notice.data.slice(0, 3).map((n) => (
                                <div className="notice" key={n.id}>
                                    <small>{date(n.created_at)}</small>
                                    <h3>{n.title}</h3>
                                    <Html markdown value={n.content} />
                                </div>
                            ))
                        ) : (
                            <p className="pad muted">{tx("暂无新公告")}</p>
                        )}
                    </State>
                </Panel>
            </div>
            <div className="metrics">
                <Metric
                    label={tx("已用流量")}
                    value={bytes(used)}
                    detail={tx("总流量 {{value0}}", {
                        value0: bytes(user.transfer_enable),
                    })}
                />
                <Metric label={tx("账户余额")} value={money(user.balance)} />
                <Metric
                    label={tx("订阅到期")}
                    value={
                        !s.plan
                            ? tx("尚未订阅套餐")
                            : user.expired_at
                              ? new Date(
                                    user.expired_at * 1000,
                                ).toLocaleDateString(locale())
                              : tx("长期有效")
                    }
                    detail={s.plan?.name || tx("尚未订阅套餐")}
                />
            </div>
            <details
                className="subscription-details"
                onToggle={(event) => setMore(event.currentTarget.open)}
            >
                <summary>{e("nodes")}</summary>
                {more && <Subscribe />}
            </details>
        </State>
    );
}
export function Subscribe() {
    const d = useData("user/getSubscribe"),
        nodes = useData<Row[]>("user/server/fetch");
    const s = d.data || {};
    return (
        <>
            <Panel title={tx("订阅连接")}>
                <State {...d} retry={d.reload}>
                    <div className="pad">
                        <h3>{s.plan?.name || tx("暂无订阅套餐")}</h3>
                        <p className="muted">
                            {tx("订阅链接包含你的访问凭据，请妥善保管。")}
                        </p>
                        {s.subscribe_url ? (
                            <>
                                <input
                                    readOnly
                                    value={s.subscribe_url}
                                    aria-label={tx("订阅链接")}
                                />
                                <div className="actions space">
                                    <SubscriptionImport url={s.subscribe_url} />
                                    <CopyValue
                                        value={s.subscribe_url}
                                        label={tx("复制订阅")}
                                    />
                                    <a
                                        className="button"
                                        href={s.subscribe_url}
                                    >
                                        <Download size={16} />
                                        {tx("下载订阅")}
                                    </a>
                                    <button
                                        onClick={() => {
                                            if (
                                                confirm(
                                                    tx(
                                                        "重置后，现有订阅链接将失效。继续吗？",
                                                    ),
                                                )
                                            )
                                                request("user/resetSecurity")
                                                    .then(d.reload)
                                                    .catch((e) =>
                                                        alert(e.message),
                                                    );
                                        }}
                                    >
                                        {tx("重置订阅链接")}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <button
                                className="primary"
                                onClick={() => navigate("plan")}
                            >
                                {tx("选择套餐")}
                            </button>
                        )}
                    </div>
                </State>
            </Panel>
            <Panel title={tx("可用节点")}>
                <State {...nodes} retry={nodes.reload}>
                    <Table
                        data={nodes.data || []}
                        columns={[
                            ["name", tx("节点名称")],
                            ["type", tx("协议")],
                            ["rate", tx("倍率")],
                            [
                                "is_online",
                                tx("状态"),
                                (r) => (
                                    <span
                                        className={`badge ${r.is_online ? "success" : ""}`}
                                    >
                                        {r.is_online ? tx("在线") : tx("离线")}
                                    </span>
                                ),
                            ],
                        ]}
                    />
                </State>
            </Panel>
        </>
    );
}
export function Plans() {
    const d = useData<Row[]>("user/plan/fetch");
    const [selected, setSelected] = useState<Row | null>(null);
    return (
        <State {...d} retry={d.reload}>
            <div className="plans">
                {d.data?.length ? (
                    d.data.map((p) => (
                        <article className="plan-card" key={p.id}>
                            <span className="eyebrow">SUBSCRIPTION</span>
                            <h2>{p.name}</h2>
                            <div className="plan-price">
                                {money(
                                    p.month_price ??
                                        p.year_price ??
                                        p.onetime_price,
                                )}
                                <small>
                                    {" "}
                                    /{" "}
                                    {p.month_price !== null
                                        ? tx("月")
                                        : p.year_price !== null
                                          ? tx("年")
                                          : tx("次")}
                                </small>
                            </div>
                            <div className="plan-feature">
                                {p.transfer_enable} {tx("GB 流量")}
                            </div>
                            <div className="plan-feature">
                                {p.speed_limit
                                    ? tx("{{value0}} Mbps 速率", {
                                          value0: p.speed_limit,
                                      })
                                    : tx("不限速")}
                            </div>
                            <div className="plan-feature">
                                {p.device_limit
                                    ? tx("{{count}} 台设备", {
                                          count: p.device_limit,
                                      })
                                    : tx("不限设备数")}
                            </div>
                            <Html value={p.content} />
                            <button
                                className="primary"
                                onClick={() => setSelected(p)}
                            >
                                {tx("选择套餐")}
                                <ArrowUpRight size={16} />
                            </button>
                        </article>
                    ))
                ) : (
                    <Empty text={tx("暂无可购买套餐")} />
                )}
            </div>
            {selected && (
                <Modal
                    title={tx("购买 {{value0}}", { value0: selected.name })}
                    close={() => setSelected(null)}
                >
                    <Editor
                        fields={[
                            {
                                key: "period",
                                label: tx("支付周期"),
                                type: "select",
                                options: Object.entries(periods)
                                    .filter(
                                        ([k]) =>
                                            selected[k] !== null &&
                                            selected[k] !== undefined,
                                    )
                                    .map(([k, v]) => [
                                        k,
                                        `${tx(v)} · ${money(selected[k])}`,
                                    ]),
                            },
                            { key: "coupon_code", label: tx("优惠码（可选）") },
                        ]}
                        initial={{
                            plan_id: selected.id,
                            period: Object.keys(periods).find(
                                (k) =>
                                    selected[k] !== null &&
                                    selected[k] !== undefined,
                            ),
                        }}
                        submit={tx("创建订单")}
                        onSave={async (body) => {
                            const r = await request<string>(
                                "user/order/save",
                                body,
                            );
                            navigate("order/" + r.data);
                            setSelected(null);
                        }}
                    />
                </Modal>
            )}
        </State>
    );
}
export function Orders({ tradeNo }: { tradeNo?: string }) {
    const d = useData<Row[] | Row>(
        tradeNo
            ? query("user/order/detail", { trade_no: tradeNo })
            : "user/order/fetch",
    );
    return (
        <Panel
            title={tradeNo ? tx("订单详情") : tx("订单记录")}
            actions={<Reload onClick={d.reload} />}
        >
            <State {...d} retry={d.reload}>
                {tradeNo ? (
                    <OrderDetail order={d.data as Row} reload={d.reload} />
                ) : (
                    <Table
                        data={rows(d.data)}
                        columns={[
                            ["trade_no", tx("订单编号")],
                            [
                                "plan",
                                tx("套餐"),
                                (r) => r.plan?.name || tx("账户充值"),
                            ],
                            [
                                "total_amount",
                                tx("金额"),
                                (r) => money(r.total_amount),
                            ],
                            [
                                "status",
                                tx("状态"),
                                (r) => (
                                    <span className="badge">
                                        {tx(
                                            statuses[r.status] ||
                                                String(r.status),
                                        )}
                                    </span>
                                ),
                            ],
                            [
                                "created_at",
                                tx("创建时间"),
                                (r) => date(r.created_at),
                            ],
                        ]}
                        actions={(r) => (
                            <button
                                onClick={() => navigate("order/" + r.trade_no)}
                            >
                                {tx("查看")}
                            </button>
                        )}
                    />
                )}
            </State>
        </Panel>
    );
}
function OrderDetail({ order, reload }: { order: Row; reload: () => void }) {
    const methods = useData<Row[]>("user/order/getPaymentMethod");
    const [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [qr, setQr] = useState("");
    const [cardMethod, setCardMethod] = useState<number | null>(null);
    async function pay(id: number, token?: string) {
        setBusy(true);
        setError("");
        try {
            const r = await request("user/order/checkout", {
                trade_no: order.trade_no,
                method: id,
                ...(token ? { token } : {}),
            });
            if (r.type === -1 || r.type === 2) {
                setCardMethod(null);
                reload();
            } else if (
                r.type === 1 &&
                typeof r.data === "string" &&
                /^https?:\/\//.test(r.data)
            )
                location.assign(r.data);
            else if (r.type === 0) setQr(String(r.data));
            else
                throw new Error(
                    tx("此支付方式需要专用客户端，请选择其他方式。"),
                );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="pad">
            <div className="metrics">
                <Metric
                    label={tx("订单编号")}
                    value={<small>{order.trade_no}</small>}
                />
                <Metric
                    label={tx("应付金额")}
                    value={money(order.total_amount)}
                />
                <Metric
                    label={tx("订单状态")}
                    value={tx(statuses[order.status] || "—")}
                />
            </div>
            <h3>{order.plan?.name}</h3>
            {error && <div className="alert">{error}</div>}
            {order.status === 0 && (
                <>
                    <p>{tx("选择支付方式")}</p>
                    <State {...methods}>
                        {methods.data?.map((m) => (
                            <button
                                key={m.id}
                                disabled={busy}
                                onClick={() =>
                                    m.payment === "StripeCredit"
                                        ? setCardMethod(m.id)
                                        : pay(m.id)
                                }
                            >
                                {m.name}
                                <ExternalLink size={14} />
                            </button>
                        ))}
                        {Number(order.total_amount) <= 0 && (
                            <button
                                className="primary"
                                disabled={busy}
                                onClick={() => pay(0)}
                            >
                                {tx("确认开通")}
                            </button>
                        )}
                        {!methods.data?.length &&
                            Number(order.total_amount) > 0 && (
                                <p className="muted">
                                    {tx("暂无可用支付方式，请联系客服。")}
                                </p>
                            )}
                    </State>
                    <div className="actions space">
                        <button
                            onClick={async () => {
                                try {
                                    await request("user/order/cancel", {
                                        trade_no: order.trade_no,
                                    });
                                    reload();
                                } catch (e) {
                                    setError((e as Error).message);
                                }
                            }}
                        >
                            {tx("取消订单")}
                        </button>
                        <button onClick={reload}>{tx("检查支付结果")}</button>
                    </div>
                </>
            )}
            {qr && (
                <div className="pad">
                    <QRCodeSVG value={qr} size={220} marginSize={3} />
                    <p>{tx("付款内容")}</p>
                    <input readOnly value={qr} />
                    <CopyValue value={qr} />
                </div>
            )}
            {cardMethod && (
                <Modal
                    title={tx("信用卡支付")}
                    close={() => setCardMethod(null)}
                >
                    <StripeCard
                        method={cardMethod}
                        onToken={(token) => pay(cardMethod, token)}
                    />
                </Modal>
            )}
        </div>
    );
}
function StripeCard({
    method,
    onToken,
}: {
    method: number;
    onToken: (token: string) => Promise<void>;
}) {
    const host = useRef<HTMLDivElement>(null),
        stripe = useRef<Stripe | null>(null),
        card = useRef<StripeCardElement | null>(null);
    const [error, setError] = useState(""),
        [ready, setReady] = useState(false),
        [busy, setBusy] = useState(false);
    useEffect(() => {
        let live = true;
        request<string>("user/comm/getStripePublicKey", { id: method })
            .then((r) => loadStripe(r.data))
            .then((s) => {
                if (!live || !s || !host.current) return;
                stripe.current = s;
                card.current = s.elements().create("card");
                card.current.mount(host.current);
                card.current.on("ready", () => setReady(true));
                card.current.on("change", (event) =>
                    setError(event.error?.message || ""),
                );
            })
            .catch((e) => {
                if (live) setError(e.message);
            });
        return () => {
            live = false;
            card.current?.destroy();
        };
    }, [method]);
    return (
        <div className="pad">
            <div ref={host} />
            {error && <div className="alert">{error}</div>}
            <button
                className="primary space"
                disabled={!ready || busy}
                onClick={async () => {
                    if (!stripe.current || !card.current) return;
                    setBusy(true);
                    try {
                        const result = await stripe.current.createToken(
                            card.current,
                        );
                        if (result.error) throw new Error(result.error.message);
                        if (result.token) await onToken(result.token.id);
                    } catch (e) {
                        setError((e as Error).message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {tx("确认支付")}
            </button>
        </div>
    );
}
export function Knowledge() {
    const [language, setLanguage] = useState(locale()),
        [keyword, setKeyword] = useState(""),
        [id, setId] = useState<number | null>(null);
    const interfaceLanguage = locale();
    useEffect(() => setLanguage(interfaceLanguage), [interfaceLanguage]);
    const d = useData(query("user/knowledge/fetch", { language, keyword })),
        article = useData(
            id
                ? query("user/knowledge/fetch", { id })
                : "user/knowledge/getCategory",
        );
    return (
        <>
            <Panel
                title={tx("使用文档")}
                actions={
                    <>
                        <select
                            aria-label={tx("文档语言")}
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                        >
                            {languages.map((l) => (
                                <option value={l.code} key={l.code}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                        <input
                            placeholder={tx("搜索文档…")}
                            aria-label={tx("搜索文档")}
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                    </>
                }
            >
                <State {...d} retry={d.reload}>
                    {Object.entries(d.data || {}).length ? (
                        Object.entries(d.data || {}).map(
                            ([category, items]) => (
                                <div className="pad" key={category}>
                                    <h3>{category}</h3>
                                    {rows(items).map((item) => (
                                        <button
                                            className="article-link"
                                            key={item.id}
                                            onClick={() => setId(item.id)}
                                        >
                                            <span>{item.title}</span>
                                            <ArrowUpRight size={16} />
                                        </button>
                                    ))}
                                </div>
                            ),
                        )
                    ) : (
                        <Empty text={tx("暂无相关文档")} />
                    )}
                </State>
            </Panel>
            {id && (
                <Modal
                    title={article.data?.title || tx("文档")}
                    close={() => setId(null)}
                >
                    <State {...article}>
                        <div className="pad">
                            <Html markdown value={article.data?.body} />
                        </div>
                    </State>
                </Modal>
            )}
        </>
    );
}
export function Tickets({
    isAdmin = false,
    queryParams = {},
    toolbar,
    pageSize = 20,
    heading,
    adminColumns,
}: {
    isAdmin?: boolean;
    queryParams?: Row;
    toolbar?: ReactNode;
    pageSize?: number;
    heading?: string;
    adminColumns?: [string, string, ((row: Row) => ReactNode)?][];
}) {
    const [page, setPage] = useState(1);
    const prefix = isAdmin ? boot.adminPath : "user";
    const [id, setId] = useState<number | null>(null),
        [creating, setCreating] = useState(false);
    const d = useData<Row[]>(
            query(`${prefix}/ticket/fetch`, {
                current: page,
                pageSize,
                ...queryParams,
            }),
        ),
        detail = useData(
            id
                ? query(`${prefix}/ticket/fetch`, { id })
                : `${prefix}/ticket/fetch`,
        );
    return (
        <>
            <Panel
                title={heading || tx("工单中心")}
                actions={
                    <>
                        <Reload onClick={d.reload} />
                        {!isAdmin && (
                            <button
                                className="primary"
                                onClick={() => setCreating(true)}
                            >
                                {tx("创建工单")}
                            </button>
                        )}
                    </>
                }
            >
                {toolbar}
                <State {...d} retry={d.reload}>
                    <Table
                        data={d.data || []}
                        columns={
                            adminColumns || [
                                ["id", tx("编号")],
                                ["subject", tx("主题")],
                                [
                                    "status",
                                    tx("状态"),
                                    (r) => (
                                        <span className="badge">
                                            {r.status === 0
                                                ? tx("处理中")
                                                : tx("已关闭")}
                                        </span>
                                    ),
                                ],
                                [
                                    "updated_at",
                                    tx("更新时间"),
                                    (r) => date(r.updated_at),
                                ],
                            ]
                        }
                        actions={(r) => (
                            <>
                                <button onClick={() => setId(r.id)}>
                                    {tx("查看对话")}
                                </button>
                                {isAdmin && (
                                    <button
                                        disabled={r.status !== 0}
                                        onClick={async () => {
                                            try {
                                                await request(
                                                    `${prefix}/ticket/close`,
                                                    { id: r.id },
                                                );
                                                d.reload();
                                            } catch (e) {
                                                alert((e as Error).message);
                                            }
                                        }}
                                    >
                                        {tx("关闭工单")}
                                    </button>
                                )}
                            </>
                        )}
                    />
                    {isAdmin && d.total > 0 && (
                        <Pager
                            page={page}
                            total={d.total}
                            size={pageSize}
                            onChange={setPage}
                        />
                    )}
                </State>
            </Panel>
            {creating && (
                <Modal title={tx("创建工单")} close={() => setCreating(false)}>
                    <Editor
                        fields={[
                            {
                                key: "subject",
                                label: tx("主题"),
                                required: true,
                            },
                            {
                                key: "level",
                                label: tx("优先级"),
                                type: "select",
                                options: [
                                    ["0", tx("普通")],
                                    ["1", tx("中等")],
                                    ["2", tx("紧急")],
                                ],
                            },
                            {
                                key: "message",
                                label: tx("问题描述"),
                                type: "textarea",
                                required: true,
                            },
                        ]}
                        initial={{ level: 0 }}
                        onSave={async (body) => {
                            await request("user/ticket/save", body);
                            setCreating(false);
                            d.reload();
                        }}
                    />
                </Modal>
            )}
            {id && (
                <Modal
                    title={detail.data?.subject || tx("工单对话")}
                    close={() => setId(null)}
                >
                    <State {...detail}>
                        <div className="messages">
                            {rows(detail.data?.message).map((m) => (
                                <div
                                    className={
                                        "message " + (m.is_me ? "mine" : "")
                                    }
                                    key={m.id}
                                >
                                    <small>
                                        {m.is_me ? tx("我") : tx("对方")} ·{" "}
                                        {date(m.created_at)}
                                    </small>
                                    <p>{m.message}</p>
                                </div>
                            ))}
                        </div>
                        {detail.data?.status === 0 && (
                            <>
                                <Editor
                                    fields={[
                                        {
                                            key: "message",
                                            label: tx("回复内容"),
                                            type: "textarea",
                                            required: true,
                                        },
                                    ]}
                                    initial={{ id }}
                                    submit={tx("发送回复")}
                                    onSave={async (body) => {
                                        await request(
                                            `${prefix}/ticket/reply`,
                                            body,
                                        );
                                        detail.reload();
                                        d.reload();
                                    }}
                                />
                                <div className="pad">
                                    <button
                                        onClick={async () => {
                                            try {
                                                await request(
                                                    `${prefix}/ticket/close`,
                                                    { id },
                                                );
                                                detail.reload();
                                                d.reload();
                                            } catch (e) {
                                                alert((e as Error).message);
                                            }
                                        }}
                                    >
                                        {tx("关闭工单")}
                                    </button>
                                </div>
                            </>
                        )}
                    </State>
                </Modal>
            )}
        </>
    );
}
export function Invite() {
    const config = useData("user/comm/config");
    const d = useData("user/invite/fetch"),
        details = useData<Row[]>("user/invite/details");
    const v = d.data || {},
        stat = v.stat || [];
    return (
        <State {...d} retry={d.reload}>
            <div className="metrics">
                <Metric label={tx("邀请用户")} value={stat[0] || 0} />
                <Metric label={tx("可用佣金")} value={money(stat[4])} />
                <Metric label={tx("佣金比例")} value={`${stat[3] || 0}%`} />
            </div>
            <Panel
                title={tx("邀请链接")}
                actions={
                    <button
                        className="primary"
                        onClick={async () => {
                            try {
                                await request("user/invite/save");
                                d.reload();
                            } catch (e) {
                                alert((e as Error).message);
                            }
                        }}
                    >
                        {tx("生成邀请码")}
                    </button>
                }
            >
                <Table
                    data={v.codes || []}
                    columns={[
                        ["code", tx("邀请码")],
                        [
                            "created_at",
                            tx("创建时间"),
                            (r) => date(r.created_at),
                        ],
                    ]}
                    actions={(r) => (
                        <CopyValue
                            value={`${location.origin}/#/register?code=${r.code}`}
                            label={tx("复制邀请链接")}
                        />
                    )}
                />
            </Panel>
            <Panel title={tx("佣金记录")}>
                <State {...details}>
                    <Table
                        data={details.data || []}
                        columns={[
                            ["trade_no", tx("订单")],
                            [
                                "order_amount",
                                tx("订单金额"),
                                (r) => money(r.order_amount),
                            ],
                            [
                                "get_amount",
                                tx("佣金"),
                                (r) => money(r.get_amount),
                            ],
                            [
                                "created_at",
                                tx("时间"),
                                (r) => date(r.created_at),
                            ],
                        ]}
                    />
                </State>
            </Panel>
            <Panel title={tx("佣金操作")}>
                <Editor
                    fields={[
                        {
                            key: "transfer_amount",
                            label: e("transferAmount", {
                                currency: boot.currencySymbol,
                            }),
                            scale: 100,
                            min: 0.01,
                            step: 0.01,
                            type: "number",
                            required: true,
                        },
                    ]}
                    initial={{}}
                    submit={tx("转入余额")}
                    onSave={async (b) => {
                        await request("user/transfer", b);
                        d.reload();
                    }}
                />
            </Panel>
            {config.data && !config.data.withdraw_close && (
                <Panel title={tx("申请佣金提现")}>
                    <Editor
                        fields={[
                            {
                                key: "withdraw_method",
                                label: tx("提现方式"),
                                type: "select",
                                options: (
                                    config.data.withdraw_methods || []
                                ).map((m: string) => [m, m]),
                            },
                            {
                                key: "withdraw_account",
                                label: tx("收款账户"),
                                required: true,
                            },
                        ]}
                        initial={{}}
                        submit={tx("提交提现申请")}
                        onSave={async (b) => {
                            await request("user/ticket/withdraw", b);
                            navigate("ticket");
                        }}
                    />
                </Panel>
            )}
        </State>
    );
}
export function Profile() {
    const config = useData("user/comm/config");
    const d = useData("user/info"),
        sessions = useData<Row[]>("user/getActiveSession");
    const [notice, setNotice] = useState("");
    const password: Field[] = [
        {
            key: "old_password",
            label: tx("当前密码"),
            type: "password",
            required: true,
        },
        {
            key: "new_password",
            label: tx("新密码"),
            type: "password",
            required: true,
        },
    ];
    return (
        <>
            <Panel title={tx("账户信息")}>
                <State {...d}>
                    <div className="pad">
                        <h3>{d.data?.email}</h3>
                        <p className="muted">
                            {tx("管理密码、流量提醒和账户余额。")}
                        </p>
                    </div>
                    <Editor
                        fields={[
                            {
                                key: "remind_expire",
                                label: tx("到期提醒"),
                                type: "switch",
                                options: [
                                    ["1", tx("开启")],
                                    ["0", tx("关闭")],
                                ],
                            },
                            {
                                key: "remind_traffic",
                                label: tx("流量提醒"),
                                type: "switch",
                                options: [
                                    ["1", tx("开启")],
                                    ["0", tx("关闭")],
                                ],
                            },
                        ]}
                        initial={d.data || {}}
                        onSave={async (b) => {
                            await request("user/update", {
                                remind_expire: b.remind_expire,
                                remind_traffic: b.remind_traffic,
                            });
                            setNotice(tx("提醒设置已保存"));
                            d.reload();
                        }}
                    />
                </State>
            </Panel>
            <Panel title={tx("修改密码")}>
                <Editor
                    fields={password}
                    initial={{}}
                    onSave={async (b) => {
                        await request("user/changePassword", b);
                        setNotice(tx("密码已更新"));
                    }}
                />
            </Panel>
            <div className="split">
                <Panel title={tx("兑换礼品卡")}>
                    <Editor
                        fields={[
                            {
                                key: "giftcard",
                                label: tx("礼品卡代码"),
                                required: true,
                            },
                        ]}
                        initial={{}}
                        submit={tx("兑换")}
                        onSave={async (b) => {
                            await request("user/redeemgiftcard", b);
                            setNotice(tx("兑换成功"));
                            d.reload();
                        }}
                    />
                </Panel>
                <Panel title={tx("账户充值")}>
                    <Editor
                        fields={[
                            {
                                key: "deposit_amount",
                                label: e("depositAmount", {
                                    currency: boot.currencySymbol,
                                }),
                                scale: 100,
                                min: 0.01,
                                step: 0.01,
                                type: "number",
                                required: true,
                            },
                        ]}
                        initial={{ plan_id: 0 }}
                        submit={tx("创建充值订单")}
                        onSave={async (b) => {
                            const r = await request<string>(
                                "user/order/save",
                                b,
                            );
                            navigate("order/" + r.data);
                        }}
                    />
                </Panel>
            </div>
            {notice && (
                <div className="success-message" role="status">
                    {notice}
                </div>
            )}
            <Panel title={tx("活跃会话")}>
                <State {...sessions}>
                    <Table
                        data={Object.entries(sessions.data || {}).map(
                            ([id, value]) => ({ ...value, id }),
                        )}
                        columns={[
                            ["ip", tx("IP 地址")],
                            ["ua", tx("客户端")],
                            [
                                "login_at",
                                tx("登录时间"),
                                (r) => date(r.login_at),
                            ],
                        ]}
                        actions={(r) => (
                            <button
                                onClick={async () => {
                                    try {
                                        await request(
                                            "user/removeActiveSession",
                                            { session_id: r.id },
                                        );
                                        sessions.reload();
                                    } catch (e) {
                                        alert((e as Error).message);
                                    }
                                }}
                            >
                                {tx("移除")}
                            </button>
                        )}
                    />
                </State>
            </Panel>
            {Boolean(config.data?.is_telegram) && (
                <Panel title="Telegram">
                    <div className="pad actions">
                        <button
                            onClick={async () => {
                                try {
                                    const bot = await request(
                                        "user/telegram/getBotInfo",
                                    );
                                    location.assign(
                                        `https://t.me/${bot.data.username}`,
                                    );
                                } catch (e) {
                                    setNotice((e as Error).message);
                                }
                            }}
                        >
                            {tx("打开机器人")}
                        </button>
                        {config.data?.telegram_discuss_link && (
                            <a
                                className="button"
                                href={config.data.telegram_discuss_link}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {tx("加入讨论组")}
                            </a>
                        )}
                        <button
                            onClick={async () => {
                                try {
                                    await request("user/unbindTelegram");
                                    setNotice(tx("Telegram 已解绑"));
                                    d.reload();
                                } catch (e) {
                                    setNotice((e as Error).message);
                                }
                            }}
                        >
                            {tx("解除绑定")}
                        </button>
                    </div>
                </Panel>
            )}
        </>
    );
}
export function Traffic() {
    const d = useData<Row[]>("user/stat/getTrafficLog");
    return (
        <Panel title={tx("流量记录")} actions={<Reload onClick={d.reload} />}>
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["record_at", tx("日期"), (r) => date(r.record_at)],
                        ["u", tx("上传"), (r) => bytes(r.u)],
                        ["d", tx("下载"), (r) => bytes(r.d)],
                        ["server_rate", tx("倍率")],
                    ]}
                />
            </State>
        </Panel>
    );
}
