import { useState, useEffect, useRef } from "react";
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
    label = "复制",
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
                        setError("复制失败，请手动复制链接");
                    }
                }}
            >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "已复制" : label}
            </button>
            {error && <span role="alert">{error}</span>}
        </>
    );
}
export function UserDashboard() {
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
            <div className="hero">
                <div>
                    <span className="eyebrow">YOUR CONNECTION, SIMPLIFIED</span>
                    <h2>连接世界，从这里开始。</h2>
                    <p>查看订阅状态，轻松管理你的网络服务。</p>
                    <button
                        className="primary"
                        onClick={() => navigate("plan")}
                    >
                        探索订阅套餐 <ArrowUpRight size={18} />
                    </button>
                </div>
                <div className="orbit">
                    <div className="orbit-inner">
                        V<span>CONNECTED</span>
                    </div>
                </div>
            </div>
            <div className="metrics">
                <Metric
                    label="已用流量"
                    value={bytes(used)}
                    detail={`总流量 ${bytes(user.transfer_enable)}`}
                />
                <Metric label="账户余额" value={money(user.balance)} />
                <Metric
                    label="订阅到期"
                    value={
                        user.expired_at
                            ? new Date(
                                  user.expired_at * 1000,
                              ).toLocaleDateString("zh-CN")
                            : "长期有效"
                    }
                    detail={s.plan?.name || "尚未订阅套餐"}
                />
            </div>
            <div className="split">
                <Panel
                    title="我的订阅"
                    actions={
                        <button onClick={() => navigate("subscribe")}>
                            管理订阅 <ArrowUpRight size={15} />
                        </button>
                    }
                >
                    <div className="pad">
                        <h3>{s.plan?.name || "准备好开启连接了吗？"}</h3>
                        <div className="progress">
                            <i style={{ width: percent + "%" }} />
                        </div>
                        <div className="muted">
                            已使用 {percent.toFixed(1)}% · {bytes(used)} /{" "}
                            {bytes(user.transfer_enable)}
                        </div>
                        {s.subscribe_url && (
                            <div className="actions space">
                                <CopyValue
                                    value={s.subscribe_url}
                                    label="复制订阅链接"
                                />
                            </div>
                        )}
                    </div>
                </Panel>
                <Panel title="最新公告">
                    <State {...notice} retry={notice.reload}>
                        {notice.data?.length ? (
                            notice.data.slice(0, 3).map((n) => (
                                <div className="notice" key={n.id}>
                                    <small>{date(n.created_at)}</small>
                                    <h3>{n.title}</h3>
                                    <Html value={n.content} />
                                </div>
                            ))
                        ) : (
                            <Empty text="暂无新公告" />
                        )}
                    </State>
                </Panel>
            </div>
        </State>
    );
}
export function Subscribe() {
    const d = useData("user/getSubscribe"),
        nodes = useData<Row[]>("user/server/fetch");
    const s = d.data || {};
    return (
        <>
            <Panel title="订阅连接">
                <State {...d} retry={d.reload}>
                    <div className="pad">
                        <h3>{s.plan?.name || "暂无订阅套餐"}</h3>
                        <p className="muted">
                            订阅链接包含你的访问凭据，请妥善保管。
                        </p>
                        {s.subscribe_url ? (
                            <>
                                <input
                                    readOnly
                                    value={s.subscribe_url}
                                    aria-label="订阅链接"
                                />
                                <div className="actions space">
                                    <CopyValue
                                        value={s.subscribe_url}
                                        label="复制订阅"
                                    />
                                    <a
                                        className="button"
                                        href={s.subscribe_url}
                                    >
                                        <Download size={16} />
                                        下载订阅
                                    </a>
                                    <button
                                        onClick={() => {
                                            if (
                                                confirm(
                                                    "重置后，现有订阅链接将失效。继续吗？",
                                                )
                                            )
                                                request("user/resetSecurity")
                                                    .then(d.reload)
                                                    .catch((e) =>
                                                        alert(e.message),
                                                    );
                                        }}
                                    >
                                        重置订阅链接
                                    </button>
                                </div>
                            </>
                        ) : (
                            <button
                                className="primary"
                                onClick={() => navigate("plan")}
                            >
                                选择套餐
                            </button>
                        )}
                    </div>
                </State>
            </Panel>
            <Panel title="可用节点">
                <State {...nodes} retry={nodes.reload}>
                    <Table
                        data={nodes.data || []}
                        columns={[
                            ["name", "节点名称"],
                            ["type", "协议"],
                            ["rate", "倍率"],
                            [
                                "is_online",
                                "状态",
                                (r) => (
                                    <span
                                        className={`badge ${r.is_online ? "success" : ""}`}
                                    >
                                        {r.is_online ? "在线" : "离线"}
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
                                        ? "月"
                                        : p.year_price !== null
                                          ? "年"
                                          : "次"}
                                </small>
                            </div>
                            <div className="plan-feature">
                                {p.transfer_enable} GB 流量
                            </div>
                            <div className="plan-feature">
                                {p.speed_limit
                                    ? `${p.speed_limit} Mbps 速率`
                                    : "不限速"}
                            </div>
                            <div className="plan-feature">
                                {p.device_limit
                                    ? `${p.device_limit} 台设备`
                                    : "不限设备数"}
                            </div>
                            <Html value={p.content} />
                            <button
                                className="primary"
                                onClick={() => setSelected(p)}
                            >
                                选择套餐 <ArrowUpRight size={16} />
                            </button>
                        </article>
                    ))
                ) : (
                    <Empty text="暂无可购买套餐" />
                )}
            </div>
            {selected && (
                <Modal
                    title={`购买 ${selected.name}`}
                    close={() => setSelected(null)}
                >
                    <Editor
                        fields={[
                            {
                                key: "period",
                                label: "支付周期",
                                type: "select",
                                options: Object.entries(periods)
                                    .filter(
                                        ([k]) =>
                                            selected[k] !== null &&
                                            selected[k] !== undefined,
                                    )
                                    .map(([k, v]) => [
                                        k,
                                        `${v} · ${money(selected[k])}`,
                                    ]),
                            },
                            { key: "coupon_code", label: "优惠码（可选）" },
                        ]}
                        initial={{
                            plan_id: selected.id,
                            period: Object.keys(periods).find(
                                (k) =>
                                    selected[k] !== null &&
                                    selected[k] !== undefined,
                            ),
                        }}
                        submit="创建订单"
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
            title={tradeNo ? "订单详情" : "订单记录"}
            actions={<Reload onClick={d.reload} />}
        >
            <State {...d} retry={d.reload}>
                {tradeNo ? (
                    <OrderDetail order={d.data as Row} reload={d.reload} />
                ) : (
                    <Table
                        data={rows(d.data)}
                        columns={[
                            ["trade_no", "订单编号"],
                            ["plan", "套餐", (r) => r.plan?.name || "账户充值"],
                            [
                                "total_amount",
                                "金额",
                                (r) => money(r.total_amount),
                            ],
                            [
                                "status",
                                "状态",
                                (r) => (
                                    <span className="badge">
                                        {statuses[r.status] || r.status}
                                    </span>
                                ),
                            ],
                            [
                                "created_at",
                                "创建时间",
                                (r) => date(r.created_at),
                            ],
                        ]}
                        actions={(r) => (
                            <button
                                onClick={() => navigate("order/" + r.trade_no)}
                            >
                                查看
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
            else throw new Error("此支付方式需要专用客户端，请选择其他方式。");
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
                    label="订单编号"
                    value={<small>{order.trade_no}</small>}
                />
                <Metric label="应付金额" value={money(order.total_amount)} />
                <Metric label="订单状态" value={statuses[order.status]} />
            </div>
            <h3>{order.plan?.name}</h3>
            {error && <div className="alert">{error}</div>}
            {order.status === 0 && (
                <>
                    <p>选择支付方式</p>
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
                                确认开通
                            </button>
                        )}
                        {!methods.data?.length &&
                            Number(order.total_amount) > 0 && (
                                <p className="muted">
                                    暂无可用支付方式，请联系客服。
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
                            取消订单
                        </button>
                        <button onClick={reload}>检查支付结果</button>
                    </div>
                </>
            )}
            {qr && (
                <div className="pad">
                    <QRCodeSVG value={qr} size={220} marginSize={3} />
                    <p>付款内容</p>
                    <input readOnly value={qr} />
                    <CopyValue value={qr} />
                </div>
            )}
            {cardMethod && (
                <Modal title="信用卡支付" close={() => setCardMethod(null)}>
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
                确认支付
            </button>
        </div>
    );
}
export function Knowledge() {
    const [language, setLanguage] = useState("zh-CN"),
        [keyword, setKeyword] = useState(""),
        [id, setId] = useState<number | null>(null);
    const d = useData(query("user/knowledge/fetch", { language, keyword })),
        article = useData(
            id
                ? query("user/knowledge/fetch", { id })
                : "user/knowledge/getCategory",
        );
    return (
        <>
            <Panel
                title="使用文档"
                actions={
                    <>
                        <select
                            aria-label="文档语言"
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                        >
                            <option>zh-CN</option>
                            <option>en-US</option>
                            <option>zh-TW</option>
                        </select>
                        <input
                            placeholder="搜索文档…"
                            aria-label="搜索文档"
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
                        <Empty text="暂无相关文档" />
                    )}
                </State>
            </Panel>
            {id && (
                <Modal
                    title={article.data?.title || "文档"}
                    close={() => setId(null)}
                >
                    <State {...article}>
                        <div className="pad">
                            <Html value={article.data?.body} />
                        </div>
                    </State>
                </Modal>
            )}
        </>
    );
}
export function Tickets({ isAdmin = false }: { isAdmin?: boolean }) {
    const prefix = isAdmin ? boot.adminPath : "user";
    const [id, setId] = useState<number | null>(null),
        [creating, setCreating] = useState(false);
    const d = useData<Row[]>(`${prefix}/ticket/fetch`),
        detail = useData(
            id
                ? query(`${prefix}/ticket/fetch`, { id })
                : `${prefix}/ticket/fetch`,
        );
    return (
        <>
            <Panel
                title="工单中心"
                actions={
                    <>
                        <Reload onClick={d.reload} />
                        {!isAdmin && (
                            <button
                                className="primary"
                                onClick={() => setCreating(true)}
                            >
                                创建工单
                            </button>
                        )}
                    </>
                }
            >
                <State {...d} retry={d.reload}>
                    <Table
                        data={d.data || []}
                        columns={[
                            ["id", "编号"],
                            ["subject", "主题"],
                            [
                                "status",
                                "状态",
                                (r) => (
                                    <span className="badge">
                                        {r.status === 0 ? "处理中" : "已关闭"}
                                    </span>
                                ),
                            ],
                            [
                                "updated_at",
                                "更新时间",
                                (r) => date(r.updated_at),
                            ],
                        ]}
                        actions={(r) => (
                            <button onClick={() => setId(r.id)}>
                                查看对话
                            </button>
                        )}
                    />
                </State>
            </Panel>
            {creating && (
                <Modal title="创建工单" close={() => setCreating(false)}>
                    <Editor
                        fields={[
                            { key: "subject", label: "主题", required: true },
                            {
                                key: "level",
                                label: "优先级",
                                type: "select",
                                options: [
                                    ["0", "普通"],
                                    ["1", "中等"],
                                    ["2", "紧急"],
                                ],
                            },
                            {
                                key: "message",
                                label: "问题描述",
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
                    title={detail.data?.subject || "工单对话"}
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
                                        {m.is_me ? "我" : "对方"} ·{" "}
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
                                            label: "回复内容",
                                            type: "textarea",
                                            required: true,
                                        },
                                    ]}
                                    initial={{ id }}
                                    submit="发送回复"
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
                                        关闭工单
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
                <Metric label="邀请用户" value={stat[0] || 0} />
                <Metric label="可用佣金" value={money(stat[4])} />
                <Metric label="佣金比例" value={`${stat[3] || 0}%`} />
            </div>
            <Panel
                title="邀请链接"
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
                        生成邀请码
                    </button>
                }
            >
                <Table
                    data={v.codes || []}
                    columns={[
                        ["code", "邀请码"],
                        ["created_at", "创建时间", (r) => date(r.created_at)],
                    ]}
                    actions={(r) => (
                        <CopyValue
                            value={`${location.origin}/#/register?code=${r.code}`}
                            label="复制邀请链接"
                        />
                    )}
                />
            </Panel>
            <Panel title="佣金记录">
                <State {...details}>
                    <Table
                        data={details.data || []}
                        columns={[
                            ["trade_no", "订单"],
                            [
                                "order_amount",
                                "订单金额",
                                (r) => money(r.order_amount),
                            ],
                            ["get_amount", "佣金", (r) => money(r.get_amount)],
                            ["created_at", "时间", (r) => date(r.created_at)],
                        ]}
                    />
                </State>
            </Panel>
            <Panel title="佣金操作">
                <Editor
                    fields={[
                        {
                            key: "transfer_amount",
                            label: "转入余额金额（分）",
                            type: "number",
                            required: true,
                        },
                    ]}
                    initial={{}}
                    submit="转入余额"
                    onSave={async (b) => {
                        await request("user/transfer", b);
                        d.reload();
                    }}
                />
            </Panel>
            {config.data && !config.data.withdraw_close && (
                <Panel title="申请佣金提现">
                    <Editor
                        fields={[
                            {
                                key: "withdraw_method",
                                label: "提现方式",
                                type: "select",
                                options: (
                                    config.data.withdraw_methods || []
                                ).map((m: string) => [m, m]),
                            },
                            {
                                key: "withdraw_account",
                                label: "收款账户",
                                required: true,
                            },
                        ]}
                        initial={{}}
                        submit="提交提现申请"
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
            label: "当前密码",
            type: "password",
            required: true,
        },
        {
            key: "new_password",
            label: "新密码",
            type: "password",
            required: true,
        },
    ];
    return (
        <>
            <Panel title="账户信息">
                <State {...d}>
                    <div className="pad">
                        <h3>{d.data?.email}</h3>
                        <p className="muted">管理密码、流量提醒和账户余额。</p>
                    </div>
                    <Editor
                        fields={[
                            {
                                key: "remind_expire",
                                label: "到期提醒",
                                type: "select",
                                options: [
                                    ["1", "开启"],
                                    ["0", "关闭"],
                                ],
                            },
                            {
                                key: "remind_traffic",
                                label: "流量提醒",
                                type: "select",
                                options: [
                                    ["1", "开启"],
                                    ["0", "关闭"],
                                ],
                            },
                        ]}
                        initial={d.data || {}}
                        onSave={async (b) => {
                            await request("user/update", {
                                remind_expire: b.remind_expire,
                                remind_traffic: b.remind_traffic,
                            });
                            setNotice("提醒设置已保存");
                            d.reload();
                        }}
                    />
                </State>
            </Panel>
            <Panel title="修改密码">
                <Editor
                    fields={password}
                    initial={{}}
                    onSave={async (b) => {
                        await request("user/changePassword", b);
                        setNotice("密码已更新");
                    }}
                />
            </Panel>
            <div className="split">
                <Panel title="兑换礼品卡">
                    <Editor
                        fields={[
                            {
                                key: "giftcard",
                                label: "礼品卡代码",
                                required: true,
                            },
                        ]}
                        initial={{}}
                        submit="兑换"
                        onSave={async (b) => {
                            await request("user/redeemgiftcard", b);
                            setNotice("兑换成功");
                            d.reload();
                        }}
                    />
                </Panel>
                <Panel title="账户充值">
                    <Editor
                        fields={[
                            {
                                key: "deposit_amount",
                                label: "充值金额（分）",
                                type: "number",
                                required: true,
                            },
                        ]}
                        initial={{ plan_id: 0 }}
                        submit="创建充值订单"
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
            <Panel title="活跃会话">
                <State {...sessions}>
                    <Table
                        data={Object.entries(sessions.data || {}).map(
                            ([id, value]) => ({ ...value, id }),
                        )}
                        columns={[
                            ["ip", "IP 地址"],
                            ["ua", "客户端"],
                            ["login_at", "登录时间", (r) => date(r.login_at)],
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
                                移除
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
                            打开机器人
                        </button>
                        {config.data?.telegram_discuss_link && (
                            <a
                                className="button"
                                href={config.data.telegram_discuss_link}
                                target="_blank"
                                rel="noreferrer"
                            >
                                加入讨论组
                            </a>
                        )}
                        <button
                            onClick={async () => {
                                try {
                                    await request("user/unbindTelegram");
                                    setNotice("Telegram 已解绑");
                                    d.reload();
                                } catch (e) {
                                    setNotice((e as Error).message);
                                }
                            }}
                        >
                            解除绑定
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
        <Panel title="流量记录" actions={<Reload onClick={d.reload} />}>
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["record_at", "日期", (r) => date(r.record_at)],
                        ["u", "上传", (r) => bytes(r.u)],
                        ["d", "下载", (r) => bytes(r.d)],
                        ["server_rate", "倍率"],
                    ]}
                />
            </State>
        </Panel>
    );
}
