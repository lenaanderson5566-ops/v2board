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
        ["plan_name", "当前订阅"],
    ] as Parameters<typeof ResourcePage>[0]["resource"]["columns"],
};
export function AdminInvitations() {
    const readTab = () => {
        const value = new URLSearchParams(
            window.location.hash.split("?")[1] || "",
        ).get("tab");
        return value === "commissions" || value === "reviews"
            ? value
            : "relations";
    };
    const [tab, setTab] = useState(readTab);
    useEffect(() => {
        const changed = () => setTab(readTab());
        window.addEventListener("hashchange", changed);
        return () => window.removeEventListener("hashchange", changed);
    }, []);
    const selectTab = (value: "relations" | "commissions" | "reviews") => {
        setTab(value);
        window.location.hash =
            value === "relations"
                ? "#/invitations"
                : `#/invitations?tab=${value}`;
    };
    const [email, setEmail] = useState("");
    const [search, setSearch] = useState("");
    const filter = [
        { key: "invite_user_id", condition: ">", value: "0" },
        ...(search
            ? [{ key: "invite_by_email", condition: "模糊", value: search }]
            : []),
    ];
    return (
        <>
            <div
                className="section-tabs"
                role="tablist"
                aria-label="邀请管理视图"
            >
                <button
                    role="tab"
                    aria-selected={tab === "relations"}
                    onClick={() => selectTab("relations")}
                >
                    邀请关系
                </button>
                <button
                    role="tab"
                    aria-selected={tab === "commissions"}
                    onClick={() => selectTab("commissions")}
                >
                    佣金审核
                </button>
                <button
                    role="tab"
                    aria-selected={tab === "reviews"}
                    onClick={() => selectTab("reviews")}
                >
                    异常复核
                </button>
            </div>
            {tab === "reviews" ? (
                <InvitationReviews />
            ) : tab === "commissions" ? (
                <OrdersPage commissionMode />
            ) : (
                <ResourcePage
                    key={search}
                    resource={invitationResource}
                    searchable={false}
                    queryParams={{ filter }}
                    toolbar={
                        <form
                            className="pad actions"
                            onSubmit={(e) => {
                                e.preventDefault();
                                setSearch(email.trim());
                            }}
                        >
                            <input
                                aria-label="邀请人邮箱"
                                placeholder="按邀请人邮箱查询"
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
                        </form>
                    }
                    extraActions={(r) => (
                        <>
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
        </>
    );
}
