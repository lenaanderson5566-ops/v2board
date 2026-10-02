import { AccountPreferences } from "./AccountPreferences";
import { BillingPage } from "./BillingPage";
import { UsagePage } from "./UsagePage";
import { e } from "./experience-copy";
import { SubscriptionPurchase } from "./SubscriptionPurchase";
import { PaymentCheckout } from "./PaymentCheckout";
import { EmailInvites } from "./EmailInvites";
import { tx, locale, languages } from "./i18n";
import { SubscriptionImport } from "./SubscriptionImport";
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
import { ArrowUpRight } from "lucide-react";
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
export function UserDashboard() {
    const info = useData("user/info"),
        sub = useData("user/getSubscribe");
    const user = info.data || {},
        s = sub.data || {};
    if (!info.data)
        return (
            <State {...info} retry={info.reload}>
                <></>
            </State>
        );
    if (user.account_status && user.account_status.state !== "active")
        return (
            <State {...info} retry={info.reload}>
                <AccountEntry
                    state={user.account_status.state}
                    subscription={s}
                />
            </State>
        );
    return <UsagePage />;
}
export function Subscribe() {
    const info = useData("user/info");
    const ready = info.data?.account_status?.state === "active";
    const d = useData("user/getSubscribe"),
        nodes = useData<Row[]>(ready ? "user/server/fetch" : "");
    const s = d.data || {};
    if (!info.data)
        return (
            <State {...info} retry={info.reload}>
                <></>
            </State>
        );
    if (!ready)
        return (
            <AccountEntry
                state={info.data.account_status?.state || "new"}
                subscription={s}
            />
        );
    if (!d.data)
        return (
            <State {...d} retry={d.reload}>
                <></>
            </State>
        );
    return (
        <>
            <Panel
                title={tx("快速开始")}
                actions={
                    <a href="#/plan" className="button">
                        {tx("管理订阅")}
                    </a>
                }
            >
                <div aria-busy={d.loading}>
                    {d.loading && (
                        <p className="pad muted" role="status">
                            {e("refreshing")}
                        </p>
                    )}
                    {d.error && (
                        <div className="alert" role="alert">
                            {d.error}
                            <button onClick={d.reload}>{tx("重试")}</button>
                        </div>
                    )}
                    {s.subscribe_url &&
                    info.data.account_status?.is_available &&
                    !info.data.account_status?.quota_exhausted ? (
                        <SubscriptionImport url={s.subscribe_url} inline />
                    ) : (
                        <div className="pad">
                            <p>
                                {e(
                                    info.data.account_status?.quota_exhausted
                                        ? "exhausted"
                                        : "unavailable",
                                )}
                            </p>
                            <a className="button primary" href="#/plan">
                                {tx("管理订阅")}
                            </a>
                        </div>
                    )}
                </div>
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
                                            {r.is_online
                                                ? tx("在线")
                                                : tx("离线")}
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
    return tradeNo ? <OrderView tradeNo={tradeNo} /> : <BillingPage />;
}
function OrderView({ tradeNo }: { tradeNo: string }) {
    const d = useData<Row>(query("user/order/detail", { trade_no: tradeNo }));
    if (d.data && [2, 3, 4].includes(Number(d.data.status))) {
        return <><OrderDetail order={d.data} reload={d.reload} />{d.error && <p className="alert" role="alert">{d.error}<button onClick={d.reload}>{tx("重试")}</button></p>}</>;
    }
    return (
        <Panel title={tx("订单详情")} actions={<Reload onClick={d.reload} />}>
            {d.data ? (
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
                    <OrderDetail order={d.data} reload={d.reload} />
                </>
            ) : (
                <State {...d} retry={d.reload}>
                    <></>
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
    const d = useData("user/info");
    const [notice, setNotice] = useState("");
    return (
        <div className="settings-content account-preferences">
            <State {...d} retry={d.reload}>
                <AccountPreferences user={d.data || {}} />
            </State>
            {notice && (
                <div className="success-message" role="status">
                    {notice}
                </div>
            )}
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
        </div>
    );
}
export function Traffic() {
    return <UsagePage />;
}
