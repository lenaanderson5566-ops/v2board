import { useEffect, useRef, useState, type ReactNode } from "react";
import { boot, type Row } from "./api";

// Keep the original menu order and OneUI layout; extension pages share this shell.
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
    ["risk", "风控规则", "shield", "风控与客户端"],
    ["risk-settings", "风控设置", "settings", "风控与客户端"],
    ["blacklist-ip", "IP 黑名单", "ban", "风控与客户端"],
    ["blacklist-ua", "UA 黑名单", "ban", "风控与客户端"],
    ["clients", "客户端策略", "screen-smartphone", "风控与客户端"],
    ["online", "在线用户", "users", "运营中台"],
    ["operations", "运营概览", "speedometer", "运营中台"],
    ["usage", "用户使用情况", "graph", "运营中台"],
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
    const [dark, setDark] = useState(
        () => localStorage.getItem("v2board.admin.dark") === "1",
    );
    const dropdown = useRef<HTMLDivElement>(null);
    useEffect(() => {
        setOpen(false);
        setMenu(false);
    }, [current]);
    useEffect(() => {
        document.body.classList.toggle("admin-dark", dark);
        localStorage.setItem("v2board.admin.dark", dark ? "1" : "0");
        return () => document.body.classList.remove("admin-dark");
    }, [dark]);
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
            className={`legacy-admin sidebar-o sidebar-dark side-scroll page-header-fixed main-content-boxed ${open ? "sidebar-o-xs" : ""}`}
        >
            {open && (
                <div
                    className="v2board-nav-mask"
                    style={{ display: "block" }}
                    onClick={() => setOpen(false)}
                />
            )}
            <nav id="sidebar" aria-label="后台导航">
                <div className="smini-hidden bg-header-dark">
                    <div className="content-header justify-content-lg-center bg-black-10">
                        <a
                            className="link-fx font-size-lg text-white"
                            href={`/${boot.adminPath}`}
                        >
                            {boot.title}
                        </a>
                        <button
                            className="btn d-lg-none text-white"
                            aria-label="关闭导航"
                            onClick={() => setOpen(false)}
                        >
                            <i className="fa fa-times-circle" />
                        </button>
                    </div>
                </div>
                <div className="content-side content-side-full">
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
                                    <i
                                        className={`nav-main-link-icon si si-${icon}`}
                                    />
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
                        className="btn d-lg-none"
                        aria-label="打开导航"
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                    >
                        <i className="fa fa-bars" />
                    </button>
                    <h1 className="v2board-container-title">{title}</h1>
                    <div className="admin-header-actions">
                        <button
                            className="btn"
                            aria-label={dark ? "切换亮色模式" : "切换暗色模式"}
                            onClick={() => setDark(!dark)}
                        >
                            <i className={`fa fa-${dark ? "moon" : "sun"}`} />
                        </button>
                        <div className="dropdown d-inline-block" ref={dropdown}>
                            <button
                                className="btn"
                                id="page-header-user-dropdown"
                                aria-haspopup="menu"
                                aria-expanded={menu}
                                onClick={() => setMenu(!menu)}
                            >
                                <i className="fa fa-user-circle" />
                                <span className="d-none d-lg-inline ml-1">
                                    {user.email}
                                </span>
                                <i className="fa fa-angle-down ml-1" />
                            </button>
                            {menu && (
                                <div
                                    className="dropdown-menu dropdown-menu-right show"
                                    role="menu"
                                >
                                    <a
                                        className="dropdown-item"
                                        role="menuitem"
                                        href="/"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        用户端
                                    </a>
                                    <button
                                        className="dropdown-item"
                                        role="menuitem"
                                        onClick={logout}
                                    >
                                        登出
                                        <i className="fa fa-sign-out-alt text-danger ml-1" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>
            <main id="main-container">
                <div className="admin-content p-0 p-lg-4" data-page={current}>
                    {children}
                </div>
            </main>
        </div>
    );
}
