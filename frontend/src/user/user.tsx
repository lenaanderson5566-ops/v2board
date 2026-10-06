import { NodeList } from "./NodeList";
export { Tickets } from "../shared/Tickets";
const AccountPreferences = lazy(() => import("./AccountPreferences").then((module) => ({ default: module.AccountPreferences })));
const BillingPage = lazy(() => import("./BillingPage").then((module) => ({ default: module.BillingPage })));
const UsagePage = lazy(() => import("./UsagePage").then((module) => ({ default: module.UsagePage })));
import { e } from "../shared/experience-copy";
const SubscriptionPurchase = lazy(() => import("./SubscriptionPurchase").then((module) => ({ default: module.SubscriptionPurchase })));
const PaymentCheckout = lazy(() => import("./PaymentCheckout").then((module) => ({ default: module.PaymentCheckout })));
const EmailInvites = lazy(() => import("./EmailInvites").then((module) => ({ default: module.EmailInvites })));
import { tx, locale, languages } from "../shared/i18n";
const SubscriptionImport = lazy(() => import("./SubscriptionImport").then((module) => ({ default: module.SubscriptionImport })));
import { AccountEntry } from "./AccountEntry";
import { HelpGuides, ContactSupport } from "./HelpGuides";

import { lazy, useState, useEffect, useRef, type ReactNode } from "react";
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
} from "../shared/api";
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
} from "../shared/ui";
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
                    <NodeList nodes={nodes.data || []} />
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
        return (
            <>
                <OrderDetail order={d.data} reload={d.reload} />
                {d.error && (
                    <p className="alert" role="alert">
                        {d.error}
                        <button onClick={d.reload}>{tx("重试")}</button>
                    </p>
                )}
            </>
        );
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
export function Invite() {
    const [page, setPage] = useState(1);
    const [action, setAction] = useState<"transfer" | "withdraw" | null>(null);
    const config = useData("user/comm/config");
    const d = useData("user/invite/fetch"),
        details = useData<Row[]>(query("user/invite/details", {current: page, page_size: 20}));
    const v = d.data || {},
        stat = v.stat || [];
    return (
        <State {...d} retry={d.reload}>
            <div className="invite-page-content">
            <EmailInvites rewards={v.rewards} />
            <section className="invite-wallet">
                <div className="invite-wallet-balance">
                    <span className="muted">{tx("可用佣金")}</span>
                    <strong>{money(stat[4])}</strong>
                    <div className="invite-wallet-facts">
                        <span>{tx("邀请用户")} <b>{stat[0] || 0}</b></span>
                        <span>{tx("佣金比例")} <b>{stat[3] || 0}%</b></span>
                    </div>
                </div>
                <div className="invite-wallet-actions">
                    <button className="primary" disabled={Number(stat[4] || 0) <= 0} onClick={() => setAction("transfer")}>{tx("转入余额")}</button>
                    {config.data && !config.data.withdraw_close && <button disabled={Number(stat[4] || 0) <= 0} onClick={() => setAction("withdraw")}>{tx("申请佣金提现")}</button>}
                </div>
            </section>
            <Panel className="invite-ledger" title={tx("佣金记录")}>
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
            {details.total > 20 && <Pager page={page} total={details.total} size={20} onChange={setPage} />}
            </Panel>
            {action === "transfer" && <Modal title={tx("转入余额")} close={() => setAction(null)}>
                <div className="invite-money-form">
                <Editor
                    fields={[
                        {
                            key: "transfer_amount",
                            label: e("transferAmount", {
                                currency: "CNY",
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
                        setAction(null);
                    }}
                />
                </div>
            </Modal>}
            {action === "withdraw" && config.data && !config.data.withdraw_close && (
                <Modal title={tx("申请佣金提现")} close={() => setAction(null)}>
                    <div className="invite-money-form">
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
                    </div>
                </Modal>
            )}
            </div>
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
