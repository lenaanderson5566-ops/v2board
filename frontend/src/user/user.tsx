import { trackAction } from "./product-analytics";
import { SettingsHeading } from "./SettingsHeading";
import { AccountBenefits } from "./AccountBenefits";
import { Bell, Settings } from "lucide-react";
import { TelegramIntegration } from "./TelegramIntegration";
import { NotificationPreferences } from "./NotificationPreferences";
import { ac } from "../shared/account-copy";
import { lazy, useState, useEffect } from "react";
import { NodeList } from "./NodeList";
export { Tickets } from "../shared/Tickets";
const AccountPreferences = lazy(() => import("./AccountPreferences").then((module) => ({ default: module.AccountPreferences })));
const BillingPage = lazy(() => import("./BillingPage").then((module) => ({ default: module.BillingPage })));
const UsagePage = lazy(() => import("./UsagePage").then((module) => ({ default: module.UsagePage })));
import { e } from "../shared/experience-copy";
const SubscriptionPurchase = lazy(() => import("./SubscriptionPurchase").then((module) => ({ default: module.SubscriptionPurchase })));
const EmailInvites = lazy(() => import("./EmailInvites").then((module) => ({ default: module.EmailInvites })));
import { tx, locale, languages } from "../shared/i18n";
const SubscriptionImport = lazy(() => import("./SubscriptionImport").then((module) => ({ default: module.SubscriptionImport })));
import { AccountEntry } from "./AccountEntry";
import { HelpGuides, ContactSupport } from "./HelpGuides";

import { OrderView } from "./OrderView";
import { UnifiedCheckout } from "./UnifiedCheckout";
import { ArrowUpRight } from "lucide-react";
import {
    request,
    rows,
    query,
    money,
    date,
    navigate,
    type Row,
} from "../shared/api";
import {
    useData,
    State,
    Panel,
    Table,
    Empty,
    Html,
    Editor,
    Modal,
    Pager,
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
                {user.account_status.state !== "banned" && <AccountBenefits />}
            </State>
        );
    return <><UsagePage /><AccountBenefits /></>;
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
export function Plans({planId}: {planId?:number} = {}) {
    if (planId) return <UnifiedCheckout key={planId} planId={planId}
        initialPeriod={new URLSearchParams(location.hash.split("?")[1]).get("period") || undefined}
        replaceTradeNo={new URLSearchParams(location.hash.split("?")[1]).get("replace") || undefined}/>;
    return <SubscriptionPurchase />;
}
export function Orders({ tradeNo }: { tradeNo?: string }) {
    return tradeNo ? <OrderView tradeNo={tradeNo} /> : <BillingPage />;
}
export function Knowledge() {
    const [language, setLanguage] = useState(locale()),
        [keyword, setKeyword] = useState(""),
        [search, setSearch] = useState(""),
        [id, setId] = useState<number | null>(null);
    const interfaceLanguage = locale();
    useEffect(() => setLanguage(interfaceLanguage), [interfaceLanguage]);
    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(keyword.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    const d = useData(query("user/knowledge/fetch", { language, keyword: search })),
        article = useData(
            id
                ? query("user/knowledge/fetch", { id })
                : "",
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
                                            onClick={() => { trackAction("help_open","knowledge"); setId(item.id); }}
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
                    <strong>{money(stat[4],v.currency)}</strong>
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
                                (r) => money(r.order_amount,r.order_currency || r.currency),
                            ],
                            [
                                "get_amount",
                                tx("佣金"),
                                (r) => money(r.get_amount,r.currency),
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
        <div className="settings-content notification-settings">
            <SettingsHeading icon={<Bell size={24}/>} title={tx("通知设置")} description={ac("notificationIntro")} />
            <State {...d} retry={d.reload}>
                {d.data && <NotificationPreferences initial={d.data} />}
            </State>
        </div>
    );
}
export function Profile() {
    const config = useData("user/comm/config");
    const d = useData("user/info");
    return (
        <div className="settings-content account-preferences">
            <SettingsHeading icon={<Settings size={24}/>} title={tx("账户设置")} description={tx("账户信息")} />
            <State {...d} retry={d.reload}>
                <AccountPreferences user={d.data || {}} />
            </State>
            {Boolean(config.data?.is_telegram) && <TelegramIntegration />}
        </div>
    );
}
export function Traffic() {
    return <UsagePage />;
}
