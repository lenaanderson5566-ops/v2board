import { Menu, XCircle, CircleUser, ChevronDown, LogOut } from "lucide-react";
import { AdminIcon } from "./AdminIcon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { boot, type Row } from "../shared/api";

// Stable menu order and navigation aliases; styling is owned by admin.css.
export const legacyAdminMenu = [
    ["overview", "仪表盘", "speedometer", ""],
    ["settings", "系统配置", "equalizer", "设置"],
    ["payments", "支付配置", "credit-card", "设置"],
    ["nodes", "节点管理", "layers", "服务器"],
    ["groups", "权限组管理", "wrench", "服务器"],
    ["routes", "路由管理", "shuffle", "服务器"],
    ["plans", "订阅管理", "bag", "财务"],
    ["orders", "订单管理", "list", "财务"],
    ["coupons", "优惠券管理", "present", "财务"],
    ["giftcards", "礼品卡管理", "star", "财务"],
    ["users", "用户管理", "users", "用户"],
    ["notices", "公告管理", "speech", "用户"],
    ["tickets", "工单管理", "support", "用户"],
    ["knowledge", "知识库管理", "bulb", "用户"],
    ["system", "队列监控", "bar-chart", "指标"],
    ["operations", "风控概览", "speedometer", "风控与客户端"],
    ["client-releases", "客户端更新", "refresh", "风控与客户端"],
    ["risk", "风控规则", "shield", "风控与客户端"],
    ["risk-settings", "风控设置", "settings", "风控与客户端"],
    ["blacklist-ip", "IP 黑名单", "ban", "风控与客户端"],
    ["blacklist-ua", "UA 黑名单", "ban", "风控与客户端"],
    ["clients", "客户端策略", "screen-smartphone", "风控与客户端"],
    ["online", "在线用户", "users", "运营中台"],
    ["usage", "用户活动", "graph", "运营中台"],
    ["banners", "Banner 管理", "picture", "运营中台"],
    ["translations", "套餐多语言", "globe", "运营中台"],
    ["log-login", "登录日志", "login", "日志"],
    ["log-subscribe", "订阅日志", "notebook", "日志"],
    ["log-connection", "连接日志", "link", "日志"],
    ["log-risk", "风控命中", "shield", "日志"],
    ["system-log", "系统日志", "notebook", "日志"],
] as const;
export function adminPage(path: string): string {
    return (
        (
            {
                dashboard: "overview",
                "config/system": "settings",
                "config/payment": "payments",
                "config/theme": "settings",
                "server/manage": "nodes",
                "server/group": "groups",
                "server/route": "routes",
                plan: "plans",
                order: "orders",
                coupon: "coupons",
                giftcard: "giftcards",
                user: "users",
                notice: "notices",
                ticket: "tickets",
                knowledge: "knowledge",
                queue: "system",
                generate: "users",
            } as Record<string, string>
        )[path] ||
        path.split("/")[0] ||
        "overview"
    );
}

export function AdminShell({
    current,
    user,
    children,
    logout,
}: {
    current: string;
    user: Row;
    children: ReactNode;
    logout: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [menu, setMenu] = useState(false);
    const dropdown = useRef<HTMLDivElement>(null);
    useEffect(() => {
        setOpen(false);
        setMenu(false);
    }, [current]);
    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (!dropdown.current?.contains(e.target as Node)) setMenu(false);
        };
        const escape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setMenu(false);
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", escape);
        };
    }, []);
    const title =
        legacyAdminMenu.find(([key]) => key === current)?.[1] || "仪表盘";
    return (
        <div
            id="page-container"
            className={`admin-shell ${open ? "admin-nav-open" : ""}`}
        >
            {open && (
                <div
                    className="v2board-nav-mask"
                    style={{ display: "block" }}
                    onClick={() => setOpen(false)}
                />
            )}
            <nav id="sidebar" aria-label="后台导航">
                <div className="admin-sidebar-brand">
                    <div className="content-header">
                        <a
                            className="admin-brand-link"
                            href={`/${boot.adminPath}`}
                        >
                            {boot.title}
                        </a>
                        <button
                            className="admin-mobile-toggle"
                            aria-label="关闭导航"
                            onClick={() => setOpen(false)}
                        >
                            <XCircle size={20} aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <div className="content-side">
                    <ul className="nav-main">
                        {legacyAdminMenu.map(([key, label, icon, group], i) => (
                            <li key={key} className="nav-main-item">
                                {group &&
                                    group !== legacyAdminMenu[i - 1]?.[3] && (
                                        <div className="nav-main-heading">
                                            {group}
                                        </div>
                                    )}
                                <a
                                    className={`nav-main-link ${current === key ? "active" : ""}`}
                                    aria-current={
                                        current === key ? "page" : undefined
                                    }
                                    href={`#/${key}`}
                                >
                                    <AdminIcon name={icon} className="nav-main-link-icon" />
                                    <span className="nav-main-link-name">
                                        {label}
                                    </span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="v2board-copyright">{boot.title}</div>
            </nav>
            <header id="page-header">
                <div className="content-header">
                    <button
                        className="admin-mobile-toggle"
                        aria-label="打开导航"
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                    >
                        <Menu size={20} aria-hidden="true" />
                    </button>
                    <h1 className="v2board-container-title">{title}</h1>
                    <div className="admin-header-actions">
                        <div className="admin-account" ref={dropdown}>
                            <button
                                className="admin-account-trigger"
                                id="page-header-user-dropdown"
                                aria-haspopup="menu"
                                aria-expanded={menu}
                                onClick={() => setMenu(!menu)}
                            >
                                <CircleUser size={20} aria-hidden="true" />
                                <span className="admin-account-email">
                                    {user.email}
                                </span>
                                <ChevronDown size={16} aria-hidden="true" />
                            </button>
                            {menu && (
                                <div
                                    className="admin-account-menu"
                                    role="menu"
                                >
                                    <a
                                        className="admin-account-item"
                                        role="menuitem"
                                        href="/"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        用户端
                                    </a>
                                    <button
                                        className="admin-account-item"
                                        role="menuitem"
                                        onClick={logout}
                                    >
                                        登出
                                        <LogOut size={16} aria-hidden="true" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>
            <main id="main-container">
                <div className="admin-content" data-page={current}>
                    {children}
                </div>
            </main>
        </div>
    );
}
