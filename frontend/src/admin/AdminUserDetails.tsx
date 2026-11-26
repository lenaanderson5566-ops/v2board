import { AdminPager } from "./AdminPager";
import { formatMultiplier } from "../shared/number-format";
import { useEffect, useRef, useState } from "react";
import { AdminChoiceGroup, AdminTabs } from "./AdminChoices";
import { UserActivityContent } from "./UserActivityContent";
import { adminUserLabel } from "./admin-user-label";
import { adminOrderPayment, adminOrderPlan, adminOrderPurchaseRecord, adminOrderType } from "./admin-order-labels";
import { AdminOrderDetails } from "./AdminOrderDetails";
import { userResetHistoryLink } from "./admin-navigation";
import { admin, query, bytes, money, type Row } from "../shared/api";
import { logTime as date, AdminLogTimestamp, AdminLogTimeZone } from "./admin-log-time";
import { calendarDay, instantDate, validZone } from "../shared/timezone";
import { StatusBadge } from "../shared/StatusBadge";
import { Modal, State, Table, useData } from "../shared/ui";
export function AdminUserDetails({row, close}: {row:Row; close:()=>void}) {
    const [{ value: tab, focusPanel }, setTab] = useState({ value: "activity", focusPanel: false });
    return <Modal title={`用户详情 · ${adminUserLabel({user_id:row.id,email:row.email})}`} variant="drawer" wide className="user-details-drawer" close={close}>
        <AdminTabs label="用户详情视图" value={tab} onChange={value => setTab({ value, focusPanel: false })} options={[
            {value:"activity",label:"活动记录"},{value:"invitations",label:"邀请用户"},
            {value:"orders",label:"订单"},{value:"traffic",label:"流量记录"},
            {value:"credits",label:"流量额度包"}
        ]}>
            {tab !== "activity" && tab !== "traffic" && <AdminLogTimeZone />}
            {tab === "activity" && <UserActivityContent
                row={{user_id:row.id,email:row.email}}
                onViewCreditBatches={() => setTab({ value: "credits", focusPanel: true })}
            />}
            {tab === "invitations" && <UserInvitations row={row}/>}
            {tab === "orders" && <UserOrders row={row}/>}
            {tab === "traffic" && <UserTraffic key={row.id} row={row} close={close} />}
            {tab === "credits" && <UserCredits row={row} focusOnOpen={focusPanel}/>}
        </AdminTabs>
    </Modal>;
}
function UserInvitations({row}: {row:Row}) {
    const [page,setPage]=useState(1), [pageSize,setPageSize]=useState(10);
    const d=useData<Row[]>(query(admin("user/fetch"),{current:page,pageSize,filter:[{key:"invite_user_id",condition:"=",value:row.id}]}));
    return <div className="pad"><State {...d} retry={d.reload}>
        <Table data={d.data || []} columns={[
            ["id","用户（ID / 邮箱）",r=>adminUserLabel({user_id:r.id,email:r.email})],
            ["banned","状态",r=>Number(r.banned)===1 ? "已封禁" : "正常"],
            ["created_at","注册时间",r=>date(r.created_at)]
        ]}/>
        <AdminPager page={page} totalUnavailable={d.data == null || Boolean(d.error)} total={d.total} size={pageSize} loading={d.loading} onChange={setPage} onSizeChange={size=>{setPageSize(size);setPage(1);}}/>
    </State></div>;
}
function UserOrders({ row }: { row: Row }) {
    const plans = useData<Row[]>(admin("plan/fetch"));
    const [pageSize, setPageSize] = useState(10);
    const [page, setPage] = useState(1),
        [selected, setSelected] = useState<Row | null>(null);
    const d = useData<Row[]>(
        query(admin("order/fetch"), {
            current: page,
            pageSize,
            filter: [{ key: "user_id", condition: "=", value: row.id }],
        }),
    );
    return (
        <div className="pad">
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["trade_no", "订单号"],
                        ["type", "类型", adminOrderType],
                        ["purchase_stage", "购买记录", r => adminOrderPurchaseRecord(r) ?? "—"],
                        ["plan_name", "套餐", r => adminOrderPlan(r, plans)],
                        ["payment_display", "支付方式", adminOrderPayment],
                        [
                            "total_amount",
                            "外部应付",
                            (r) => <>
                                <div>{money(r.total_amount, r.currency)}</div>
                                {Number(r.balance_amount) > 0 &&
                                    <small className="muted">余额抵扣 {money(r.balance_amount, r.currency)}</small>}
                            </>,
                        ],
                        [
                            "status",
                            "状态",
                            (r) =>
                                [
                                    "待支付",
                                    "开通中",
                                    "已取消",
                                    "已完成",
                                    "已折抵",
                                ][r.status],
                        ],
                        ["created_at", "创建时间", (r) => date(r.created_at)],
                    ]}
                    actions={(r) => (
                        <button onClick={() => setSelected(r)}>订单详情</button>
                    )}
                />
                <AdminPager
                    page={page}
                    totalUnavailable={d.data == null || Boolean(d.error)}
                    total={d.total}
                    size={pageSize}
                    loading={d.loading}
                    onSizeChange={(size) => {
                        setPageSize(size);
                        setPage(1);
                    }}
                    onChange={setPage}
                />
            </State>
            {selected && <AdminOrderDetails commissionMode id={selected.id} close={() => setSelected(null)} plans={plans}/>}
        </div>
    );
}

const creditStates = [
    { value: "", label: "全部" },
    { value: "active", label: "可用" },
    { value: "used", label: "已用完" },
    { value: "expired", label: "已到期" },
];
const creditSources: Record<string, string> = {
    purchase: "购买",
    legacy_order: "历史订单",
    migration: "历史流量迁移",
    upgrade: "历史升级",
    invite_register: "邀请注册奖励",
    invite_first_use: "首次使用奖励",
    invite_friend_use: "好友首次使用奖励",
};

function UserCredits({ row, focusOnOpen }: { row: Row; focusOnOpen: boolean }) {
    const view = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (focusOnOpen) view.current?.focus();
    }, [focusOnOpen]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [status, setStatus] = useState("");
    const [orderId, setOrderId] = useState<number | null>(null);
    const d = useData<Row[]>(query(admin("user/creditBatches"), { user_id: row.id, current: page, pageSize, status }));
    const summary = d.meta?.summary;

    return <div className="pad user-activity" role="region" aria-label="流量额度批次" tabIndex={-1} ref={view}>
        <State {...d} retry={d.reload}>
            {summary && <section className="user-activity-summary" aria-label="流量额度概况">
                <dl>
                    <div><dt>当前可用总量</dt><dd>{bytes(summary.available_bytes)}</dd></div>
                    <div><dt>最近到期批次</dt><dd>{summary.next_expiry_at == null
                        ? "暂无待到期额度"
                        : <>{date(summary.next_expiry_at)} · 剩余 {bytes(summary.next_expiry_bytes)}</>
                    }</dd></div>
                </dl>
            </section>}
            <AdminChoiceGroup label="额度包状态" className="user-activity-filters" options={creditStates} value={status} onChange={value => {
                setStatus(value);
                setPage(1);
                setOrderId(null);
            }} />
            <p className="user-activity-caption">额度包按批次到期。这里的有效期和用户的订阅到期时间分开记录。</p>
            <Table data={d.data || []} columns={[
                ["id", "批次"],
                ["source", "来源", r => creditSources[r.source] ?? "来源未记录"],
                ["plan_name", "额度包"],
                ["trade_no", "关联订单", r => r.order_id != null && r.trade_no
                    ? <span className="admin-credit-order-ref">
                        <code>{r.trade_no}</code>
                        <button type="button" onClick={() => setOrderId(r.order_id)} aria-label={`查看订单 ${r.trade_no}`}>查看订单</button>
                    </span>
                    : "—"],
                ["granted_bytes", "发放量", r => r.granted_bytes == null ? "未记录" : bytes(r.granted_bytes)],
                ["available_bytes", "可用余量", r => bytes(r.available_bytes)],
                ["created_at", "发放时间", r => date(r.created_at)],
                ["expires_at", "到期时间", r => date(r.expires_at)],
                ["status", "状态", r => <StatusBadge tone={r.status === "active" ? "success" : "neutral"}>
                    {creditStates.find(option => option.value === r.status)?.label ?? "未知"}
                </StatusBadge>],
            ]}/>
            <AdminPager page={page} totalUnavailable={d.data == null || Boolean(d.error)} total={d.total} size={pageSize} loading={d.loading} onChange={next => {
                setPage(next);
                setOrderId(null);
            }} onSizeChange={size => {
                setPageSize(size);
                setPage(1);
                setOrderId(null);
            }}/>
        </State>
        {orderId !== null && <AdminOrderDetails commissionMode id={orderId} close={() => setOrderId(null)}/>}
    </div>;
}
type ResetCredits = { available: number; next_expires_at: number | null; next_expires_count: number };

function UserResetCreditSummary({ userId, close }: { userId: number; close: () => void }) {
    const credits = useData<ResetCredits>(query(admin("user/usageResetCredits"), { user_id: userId }));
    const summary = typeof credits.data?.available === "number" ? credits.data : null;
    const historyLink = userResetHistoryLink(userId);
    return (
        <section className="user-traffic-reset-summary" aria-label="有效储备重置">
            <State {...credits} retry={credits.reload}>
                {summary && <div className="user-traffic-reset-count">
                    <strong>有效储备重置 {summary.available} 次</strong>
                    {summary.next_expires_at != null
                        ? <span className="muted">最近到期 <AdminLogTimestamp value={summary.next_expires_at} /> · {summary.next_expires_count} 次</span>
                        : summary.available > 0 ? <span className="muted">长期有效</span> : null}
                </div>}
            </State>
            <a className="button" href={historyLink} onClick={event => {
                if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && window.location.hash === historyLink) {
                    event.preventDefault();
                    close();
                }
            }}>查看重置记录</a>
        </section>
    );
}

function UserTraffic({ row, close }: { row: Row; close: () => void }) {
    const [pageSize, setPageSize] = useState(10);
    const [page, setPage] = useState(1);
    const d = useData<Row[]>(
        query(admin("stat/getStatUser"), {
            user_id: row.id,
            current: page,
            pageSize,
        }),
    );
    return (
        <div className="pad">
            <UserResetCreditSummary userId={row.id} close={close} />
            <p className="muted">日期按记录生成时的业务时区显示。旧记录沿用上海时区。</p>
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["record_at", "统计日期", (r) => {
                            const at = instantDate(r.record_at);
                            const recordedZone = r.record_timezone;
                            const zone = typeof recordedZone === "string" && validZone(recordedZone)
                                ? recordedZone : "Asia/Shanghai";
                            return at ? calendarDay(at, zone) : "—";
                        }],
                        ["u", "上传", (r) => bytes(r.u)],
                        ["d", "下载", (r) => bytes(r.d)],
                        ["server_rate", "倍率", (record) => formatMultiplier(record.server_rate)],
                    ]}
                />
                <AdminPager
                    page={page}
                    totalUnavailable={d.data == null || Boolean(d.error)}
                    total={d.total}
                    size={pageSize}
                    loading={d.loading}
                    onSizeChange={(size) => {
                        setPageSize(size);
                        setPage(1);
                    }}
                    onChange={setPage}
                />
            </State>
        </div>
    );
}
