import { AdminFilterBar } from "./AdminFilterBar";
import { AdminTabs } from "./AdminChoices";
import { InvitationEmails } from "./InvitationEmails";
import { InvitationReviews } from "./InvitationReviews";
import { useEffect, useState } from "react";
import { admin, date, type Row } from "../shared/api";
import { ResourcePage } from "./admin";
import { OrdersPage } from "./admin-orders";
import { adminUserLabel } from "./admin-user-label";

const invitationResource = {
    title: "邀请关系",
    fetch: admin("user/fetch"),
    fields: [],
    create: false,
    columns: [
        [
            "id",
            "受邀用户（ID / 邮箱）",
            (r: Row) => adminUserLabel({ user_id: r.id, email: r.email }),
        ],
        [
            "invite_user_id",
            "邀请人（ID / 邮箱）",
            (r: Row) =>
                adminUserLabel({
                    user_id: r.invite_user_id,
                    email: r.invite_email,
                }),
        ],
        ["created_at", "注册时间", (r: Row) => date(r.created_at)],
        ["plan_name", "当前订阅", (r: Row) => r.plan_name || "无套餐"],
        [
            "last_subscribe_at",
            "最近获取订阅",
            (r: Row) =>
                r.last_subscribe_at ? date(r.last_subscribe_at) : "无记录",
        ],
        [
            "last_connected_at",
            "最近连接",
            (r: Row) =>
                r.last_connected_at ? date(r.last_connected_at) : "无记录",
        ],
    ] as Parameters<typeof ResourcePage>[0]["resource"]["columns"],
};
export function AdminInvitations() {
    const readTab = (): "relations" | "commissions" | "reviews" | "emails" => {
        const value = new URLSearchParams(
            window.location.hash.split("?")[1] || "",
        ).get("tab");
        return value === "commissions" ||
            value === "reviews" ||
            value === "emails"
            ? value
            : "relations";
    };
    const [tab, setTab] = useState(readTab);
    useEffect(() => {
        const changed = () => setTab(readTab());
        window.addEventListener("hashchange", changed);
        return () => window.removeEventListener("hashchange", changed);
    }, []);
    const selectTab = (
        value: "relations" | "commissions" | "reviews" | "emails",
    ) => {
        setTab(value);
        window.location.hash =
            value === "relations"
                ? "#/invitations"
                : `#/invitations?tab=${value}`;
    };
    const [searchField, setSearchField] = useState("invite_by_email");
    const [activeField, setActiveField] = useState("invite_by_email");
    const [email, setEmail] = useState("");
    const [search, setSearch] = useState("");
    const filter = [
        { key: "invite_user_id", condition: ">", value: "0" },
        ...(search
            ? [{ key: activeField, condition: "=", value: search }]
            : []),
    ];
    return (
        <>
            <section className="panel pad invitation-workflow">
                <div>
                    <h2>邀请与奖励</h2>
                    <p className="muted">
                        从邮件邀请、注册和连接，到佣金审核，按环节追踪。订阅与连接记录可辅助判断使用进度，不等同于付款或奖励到账。
                    </p>
                </div>
                <div className="actions">
                    <a className="button" href="#/invitation-settings">
                        奖励规则
                    </a>
                    <a className="button" href="#/analytics">
                        查看业务转化
                    </a>
                </div>
            </section>
            <AdminTabs label="邀请管理视图" value={tab} onChange={selectTab} options={[
                {value:"relations",label:"邀请关系"},{value:"commissions",label:"佣金审核"},{value:"reviews",label:"异常复核"},{value:"emails",label:"邀请邮件"}
            ]}>
            {tab === "emails" ? (
                <InvitationEmails />
            ) : tab === "reviews" ? (
                <InvitationReviews />
            ) : tab === "commissions" ? (
                <OrdersPage commissionMode />
            ) : (
                <ResourcePage
                    key={activeField + search}
                    resource={invitationResource}
                    searchable={false}
                    queryParams={{ filter }}
                    toolbar={
                        <AdminFilterBar

                            onSubmit={(e) => {
                                e.preventDefault();
                                setSearch(email.trim());
                                setActiveField(searchField);
                            }}
                        >
                            <select
                                aria-label="查询对象"
                                value={searchField}
                                onChange={(e) => setSearchField(e.target.value)}
                            >
                                <option value="invite_by_email">
                                    邀请人邮箱
                                </option>
                                <option value="email">受邀用户邮箱</option>
                            </select>
                            <input
                                aria-label="查询邮箱"
                                placeholder="输入完整邮箱"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <button>查询</button>
                            <button
                                type="button"
                                onClick={() => {
                                    setEmail("");
                                    setSearch("");
                                }}
                            >
                                清除
                            </button>
                        </AdminFilterBar>
                    }
                    extraActions={(r) => (
                        <>
                            <a
                                className="button"
                                href={`#/orders?user_id=${r.id}`}
                            >
                                查看订单
                            </a>
                            <a
                                className="button"
                                href={`#/invitations?tab=commissions&user_id=${r.id}&commission_status=`}
                            >
                                查看佣金
                            </a>
                            <a
                                className="button"
                                href={`#/users?user_id=${r.id}`}
                            >
                                受邀用户
                            </a>
                            <a
                                className="button"
                                href={`#/users?user_id=${r.invite_user_id}`}
                            >
                                邀请人
                            </a>
                        </>
                    )}
                />
            )}
            </AdminTabs>
        </>
    );
}
