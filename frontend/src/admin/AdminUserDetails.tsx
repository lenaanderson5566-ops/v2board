import { useState } from "react";
import { AdminTabs } from "./AdminChoices";
import { UserActivityContent } from "./UserActivityContent";
import { adminUserLabel } from "./admin-user-label";
import { admin, query, bytes, money, type Row } from "../shared/api";
import { logTime as date, AdminLogTimeZone } from "./admin-log-time";
import { Modal, State, Table, Pager, useData } from "../shared/ui";
export function AdminUserDetails({row, close}: {row:Row; close:()=>void}) {
    const [tab,setTab] = useState("activity");
    return <Modal title={`用户详情 · ${adminUserLabel({user_id:row.id,email:row.email})}`} variant="drawer" wide className="user-details-drawer" close={close}>
        <AdminTabs label="用户详情视图" value={tab} onChange={setTab} options={[
            {value:"activity",label:"活动记录"},{value:"invitations",label:"邀请用户"},
            {value:"orders",label:"订单"},{value:"traffic",label:"流量记录"}
        ]}>
            {tab !== "activity" && <AdminLogTimeZone />}
            {tab === "activity" && <UserActivityContent row={{user_id:row.id,email:row.email}}/>}
            {tab === "invitations" && <UserInvitations row={row}/>}
            {tab === "orders" && <UserOrders row={row}/>}
            {tab === "traffic" && <UserTraffic row={row}/>}
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
    const detail = useData(
        selected ? admin("order/detail") : "",
        selected ? { id: selected.id } : undefined,
    );
    return (
        <div className="pad">
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["trade_no", "订单号"],
                        ["plan_name", "套餐"],
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
            {selected && (
                <section>
                    <h3>订单详情</h3>
                    <button onClick={() => setSelected(null)}>收起详情</button>
                    <State {...detail} retry={detail.reload}>
                        <Table
                            data={detail.data ? [detail.data] : []}
                            columns={[
                                ["trade_no", "订单号"],
                                ["period", "周期"],
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
                </section>
            )}
        </div>
    );
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
                        ["server_rate", "倍率"],
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
