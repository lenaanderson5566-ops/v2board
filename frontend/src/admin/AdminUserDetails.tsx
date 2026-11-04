import { formatMultiplier } from "../shared/number-format";
import { useState } from "react";
import { AdminChoiceGroup, AdminTabs } from "./AdminChoices";
import { UserActivityContent } from "./UserActivityContent";
import { adminUserLabel } from "./admin-user-label";
import { adminOrderPeriod, adminOrderPlan, adminOrderType } from "./admin-order-labels";
import type { AdminPlanDirectory } from "./admin-plan-reference";
import { admin, query, bytes, money, type Row } from "../shared/api";
import { logTime as date, AdminLogTimeZone } from "./admin-log-time";
import { StatusBadge } from "../shared/StatusBadge";
import { Modal, State, Table, Pager, useData } from "../shared/ui";
export function AdminUserDetails({row, close}: {row:Row; close:()=>void}) {
    const [tab,setTab] = useState("activity");
    return <Modal title={`用户详情 · ${adminUserLabel({user_id:row.id,email:row.email})}`} variant="drawer" wide className="user-details-drawer" close={close}>
        <AdminTabs label="用户详情视图" value={tab} onChange={setTab} options={[
            {value:"activity",label:"活动记录"},{value:"invitations",label:"邀请用户"},
            {value:"orders",label:"订单"},{value:"traffic",label:"流量记录"},
            {value:"credits",label:"流量额度包"}
        ]}>
            {tab !== "activity" && <AdminLogTimeZone />}
            {tab === "activity" && <UserActivityContent row={{user_id:row.id,email:row.email}}/>}
            {tab === "invitations" && <UserInvitations row={row}/>}
            {tab === "orders" && <UserOrders row={row}/>}
            {tab === "traffic" && <UserTraffic row={row}/>}
            {tab === "credits" && <UserCredits row={row}/>}
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
        <Pager page={page} total={d.total} size={pageSize} loading={d.loading} onChange={setPage} onSizeChange={size=>{setPageSize(size);setPage(1);}}/>
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
                        ["plan_name", "套餐", r => adminOrderPlan(r, plans)],
                        [
                            "total_amount",
                            "金额",
                            (r) => money(r.total_amount, r.currency),
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
                <Pager
                    page={page}
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
            {selected && <UserOrderDetails id={selected.id} close={() => setSelected(null)} plans={plans}/>}
        </div>
    );
}

function UserOrderDetails({ id, close, plans = {} }: { id: number; close: () => void; plans?: AdminPlanDirectory }) {
    const detail = useData(admin("order/detail"), { id });
    return <section aria-label="订单详情">
        <h3>订单详情</h3>
        <button onClick={close}>收起详情</button>
        <State {...detail} retry={detail.reload}>
            <Table
                data={detail.data ? [detail.data] : []}
                columns={[
                    ["trade_no", "订单号"],
                    ["type", "类型", adminOrderType],
                    ["plan_id", "套餐", r => adminOrderPlan(r, plans)],
                    ["period", "周期", adminOrderPeriod],
                    [
                        "total_amount",
                        "订单金额",
                        (r) => money(r.total_amount, r.currency),
                    ],
                    [
                        "balance_amount",
                        "余额抵扣",
                        (r) => money(r.balance_amount, r.currency),
                    ],
                    [
                        "commission_balance",
                        "佣金",
                        (r) =>
                            money(r.commission_balance, r.currency),
                    ],
                    ["paid_at", "付款时间", (r) => date(r.paid_at)],
                ]}
            />
            <h4>佣金记录</h4>
            <Table
                data={detail.data?.commission_log || []}
                columns={[
                    [
                        "invite_user_id",
                        "邀请人（ID / 邮箱）",
                        (r) =>
                            adminUserLabel({
                                user_id: r.invite_user_id,
                                email: r.invite_email,
                            }),
                    ],
                    [
                        "get_amount",
                        "金额",
                        (r) => money(r.get_amount, r.currency),
                    ],
                    [
                        "created_at",
                        "时间",
                        (r) => date(r.created_at),
                    ],
                ]}
            />
        </State>
    </section>;
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

function UserCredits({ row }: { row: Row }) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [status, setStatus] = useState("");
    const [orderId, setOrderId] = useState<number | null>(null);
    const d = useData<Row[]>(query(admin("user/creditBatches"), { user_id: row.id, current: page, pageSize, status }));
    const summary = d.meta?.summary;

    return <div className="pad user-activity">
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
                    ? <button type="button" onClick={() => setOrderId(r.order_id)} aria-label={`查看订单 ${r.trade_no}`}>{r.trade_no}</button>
                    : "—"],
                ["granted_bytes", "发放量", r => r.granted_bytes == null ? "未记录" : bytes(r.granted_bytes)],
                ["available_bytes", "可用余量", r => bytes(r.available_bytes)],
                ["created_at", "发放时间", r => date(r.created_at)],
                ["expires_at", "到期时间", r => date(r.expires_at)],
                ["status", "状态", r => <StatusBadge tone={r.status === "active" ? "success" : "neutral"}>
                    {creditStates.find(option => option.value === r.status)?.label ?? "未知"}
                </StatusBadge>],
            ]}/>
            <Pager page={page} total={d.total} size={pageSize} loading={d.loading} onChange={next => {
                setPage(next);
                setOrderId(null);
            }} onSizeChange={size => {
                setPageSize(size);
                setPage(1);
                setOrderId(null);
            }}/>
        </State>
        {orderId !== null && <UserOrderDetails id={orderId} close={() => setOrderId(null)}/>}
    </div>;
}
function UserTraffic({ row }: { row: Row }) {
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
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["record_at", "日期", (r) => date(r.record_at)],
                        ["u", "上传", (r) => bytes(r.u)],
                        ["d", "下载", (r) => bytes(r.d)],
                        ["server_rate", "倍率", (record) => formatMultiplier(record.server_rate)],
                    ]}
                />
                <Pager
                    page={page}
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
