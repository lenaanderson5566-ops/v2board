import { e } from "./experience-copy";
import { SubscriptionPurchase } from "./SubscriptionPurchase";
import { PaymentCheckout } from "./PaymentCheckout";
import { EmailInvites } from "./EmailInvites";
import { tx, locale, languages } from "./i18n";
import { SubscriptionImport } from "./SubscriptionImport";
import { UsageChart } from "./UsageChart";
import { AccountEntry } from "./AccountEntry";
import { HelpGuides, ContactSupport } from "./HelpGuides";
import {
    supportTopics,
    unresolvedTicket,
    supportPayload,
} from "./support-flow";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe, StripeCardElement } from "@stripe/stripe-js";
import { ArrowUpRight, Copy, Check } from "lucide-react";
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
        total = Math.max(0, Number(user.transfer_enable) || 0),
        remaining = Math.max(0, total - used),
        remainingPercent = total
            ? Math.max(0, Math.min(100, (remaining / total) * 100))
            : 0;
    if (user.account_status && user.account_status.state !== "active")
        return (
            <State {...info} retry={info.reload}>
                <AccountEntry
                    state={user.account_status.state}
                    subscription={s}
                />
            </State>
        );
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
            <div className="account-status-line">
                <span className="badge success">{e("activeTitle")}</span>
                {(user.account_status?.quota_exhausted ||
                    user.account_status?.is_available === false) && (
                    <p role="status">
                        {e(
                            user.account_status?.quota_exhausted
                                ? "exhausted"
                                : "unavailable",
                        )}{" "}
                        <a href="#/plan">{e("renew")}</a>
                    </p>
                )}
            </div>
            <div className="dashboard-grid">
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
                            {s.subscribe_url &&
                                user.account_status?.is_available &&
                                !user.account_status?.quota_exhausted && (
                                    <div className="actions space">
                                        <SubscriptionImport
                                            url={s.subscribe_url}
                                        />
                                        <CopyValue
                                            value={s.subscribe_url}
                                            label={tx("复制订阅链接")}
                                        />
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
                <section className="quota-card" aria-label={e("quota")}>
                    <h3>{e("quota")}</h3>
                    <div className="quota-value">
                        <strong>
                            {total ? `${Math.round(remainingPercent)}%` : "—"}
                        </strong>
                        <span>{e("remaining")}</span>
                    </div>
                    <div
                        className="quota-progress"
                        role="progressbar"
                        aria-label={e("remaining")}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={remainingPercent}
                    >
                        <i style={{ width: `${remainingPercent}%` }} />
                    </div>
                    <p>
                        {bytes(remaining)} / {bytes(total)} · {tx("已使用")}{" "}
                        {bytes(used)}
                    </p>
                    <small>
                        {typeof s.reset_day === "number"
                            ? e("resetDays", { count: s.reset_day })
                            : e("noReset")}
                    </small>
                </section>
            </div>
            <UsageChart />
            <div className="dashboard-secondary">
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
    return <SubscriptionPurchase />;
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
            {tradeNo && d.data ? (
                <>
                    {d.loading && (
                        <p className="pad muted" role="status">
                            {e("refreshing")}
                        </p>
                    )}
                    {d.error && (
                        <div className="alert" role="alert">
                            {d.error}
                            <button onClick={d.reload}>{tx("刷新")}</button>
                        </div>
                    )}
                    <OrderDetail order={d.data as Row} reload={d.reload} />
                </>
            ) : (
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
                                    onClick={() =>
                                        navigate("order/" + r.trade_no)
                                    }
                                >
                                    {tx(
                                        Number(r.status) === 0
                                            ? "继续支付"
                                            : Number(r.status) === 1
                                              ? "查看开通进度"
                                              : "查看",
                                    )}
                                </button>
                            )}
                        />
                    )}
                </State>
            )}
        </Panel>
    );
}
function OrderDetail({ order, reload }: { order: Row; reload: () => void }) {
    return (
        <PaymentCheckout
            order={order}
            reload={reload}
            renderCard={(method, pay) => (
                <StripeCard method={method} onToken={pay} />
            )}
        />
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
            <HelpGuides />
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
            <ContactSupport />
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
    orderTradeNo,
}: {
    isAdmin?: boolean;
    queryParams?: Row;
    toolbar?: ReactNode;
    pageSize?: number;
    heading?: string;
    adminColumns?: [string, string, ((row: Row) => ReactNode)?][];
    orderTradeNo?: string;
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
    const openTicket = unresolvedTicket(d.data || []);
    return (
        <>
            {!isAdmin && (
                <div className="pad support-context">
                    <a href="#/knowledge">{tx("先查看帮助中心")}</a>
                    <p className="muted">
                        {tx("已有未关闭的工单请继续回复，避免重复提交。")}
                    </p>
                </div>
            )}
            <Panel
                title={heading || tx("工单中心")}
                actions={
                    <>
                        <Reload onClick={d.reload} />
                        {!isAdmin && (
                            <button
                                className="button"
                                disabled={d.loading || Boolean(d.error)}
                                onClick={() =>
                                    openTicket
                                        ? setId(openTicket.id)
                                        : setCreating(true)
                                }
                            >
                                {tx(openTicket ? "继续已有工单" : "创建工单")}
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
                                key: "topic",
                                label: tx("问题类型"),
                                type: "select",
                                required: true,
                                options: supportTopics.map(([value, label]) => [
                                    value,
                                    tx(label),
                                ]),
                            },
                            {
                                key: "order_trade_no",
                                label: tx("关联订单（可选）"),
                            },
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
                                hint: tx(
                                    "请说明发生时间、设备与客户端、错误提示以及已尝试的排查步骤。",
                                ),
                                type: "textarea",
                                required: true,
                            },
                        ]}
                        initial={{
                            level: 0,
                            topic: orderTradeNo ? "payment" : "other",
                            order_trade_no: orderTradeNo || "",
                        }}
                        onSave={async (body) => {
                            const latest = await request("user/ticket/fetch");
                            const existing = unresolvedTicket(
                                rows(latest.data),
                            );
                            if (existing) {
                                setCreating(false);
                                setId(existing.id);
                                d.reload();
                                return;
                            }
                            await request(
                                "user/ticket/save",
                                supportPayload(body, tx),
                            );
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
            <EmailInvites />
            <div className="metrics">
                <Metric label={tx("邀请用户")} value={stat[0] || 0} />
                <Metric label={tx("可用佣金")} value={money(stat[4])} />
                <Metric label={tx("佣金比例")} value={`${stat[3] || 0}%`} />
            </div>
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
export function Notifications() {
    const d = useData("user/info");
    return (
        <Panel title={tx("通知设置")}>
            <p className="pad muted">{tx("选择接收到期和流量使用提醒。")}</p>
            <State {...d} retry={d.reload}>
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
                        d.reload();
                    }}
                />
            </State>
        </Panel>
    );
}
export function Profile() {
    const config = useData("user/comm/config");
    const d = useData("user/info"),
        sessions = useData<Row[]>("user/getActiveSession");
    const [notice, setNotice] = useState("");
    return (
        <>
            <Panel title={tx("账户信息")}>
                <State {...d}>
                    <div className="pad">
                        <h3>{d.data?.email}</h3>
                        <p className="muted">
                            {tx("管理账户余额，或进入通知设置与账户安全。")}
                        </p>
                        <dl className="subscription-facts">
                            <div>
                                <dt>{tx("账户余额")}</dt>
                                <dd>{money(d.data?.balance)}</dd>
                            </div>
                        </dl>
                    </div>
                </State>
            </Panel>
            <div className="account-security-link">
                <a className="button" href="#/notifications">
                    {tx("通知设置")}
                    <ArrowUpRight size={15} aria-hidden="true" />
                </a>
                <a className="button" href="#/security">
                    {tx("账户安全")}
                    <ArrowUpRight size={15} aria-hidden="true" />
                </a>
            </div>
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
