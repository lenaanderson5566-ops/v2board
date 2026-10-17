import { Menu, XCircle, CircleUser, ChevronDown, LogOut } from "lucide-react";
import { AdminIcon } from "./AdminIcon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { boot, type Row } from "../shared/api";

// Stable menu order and navigation aliases; styling is owned by admin.css.
export const legacyAdminMenu = [
    ["overview", "仪表盘", "speedometer", "概览"],
    ["analytics", "访问与转化", "bar-chart", "概览"],
    ["users", "用户管理", "users", "用户与支持"],
    ["online", "在线用户", "users", "用户与支持"],
    ["tickets", "工单管理", "support", "用户与支持"],
    ["knowledge", "知识库", "bulb", "用户与支持"],
    ["plans", "套餐管理", "bag", "套餐与支付"],
    ["orders", "订单管理", "list", "套餐与支付"],
    ["payments", "支付渠道", "credit-card", "套餐与支付"],
    ["coupons", "优惠券管理", "present", "营销与内容"],
    ["giftcards", "礼品卡管理", "star", "营销与内容"],
    ["invitations", "邀请与奖励", "users", "营销与内容"],
    ["notices", "公告管理", "speech", "营销与内容"],
    ["banners", "横幅管理", "picture", "营销与内容"],
    ["nodes", "节点管理", "layers", "节点与接入"],
    ["groups", "节点权限组", "wrench", "节点与接入"],
    ["routes", "路由管理", "shuffle", "节点与接入"],
    ["clients", "访问与版本策略", "shield", "客户端"],
    ["client-releases", "第三方客户端", "screen-smartphone", "客户端"],
    ["risk", "风控规则", "shield", "安全与风控"],
    ["blacklist-ip", "IP 黑名单", "ban", "安全与风控"],
    ["blacklist-ua", "UA 黑名单", "ban", "安全与风控"],
    ["mail-blocklist", "邮件禁发名单", "ban", "安全与风控"],
    ["log-login", "登录日志", "login", "日志与诊断"],
    ["log-subscribe", "订阅请求日志", "notebook", "日志与诊断"],
    ["log-connection", "连接日志", "link", "日志与诊断"],
    ["log-risk", "风控命中日志", "shield", "日志与诊断"],
    ["mail-logs", "邮件发送日志", "notebook", "日志与诊断"],
    ["client-diagnostics", "客户端运行记录", "screen-smartphone", "日志与诊断"],
    ["system-log", "系统日志", "notebook", "日志与诊断"],
    ["settings", "系统配置", "equalizer", "系统设置"],
    ["log-settings", "日志与保留策略", "settings", "系统设置"],
    ["security", "管理员账户安全", "shield", "系统设置"],
] as const;
// Keep old labels and common task terms searchable after regrouping.
const adminMenuKeywords: Record<string, string> = {
    overview: "运营概览 系统状态 队列 风控概览",
    analytics: "访问统计 漏斗 转化率 隐私",
    plans: "订阅管理 订阅套餐 套餐翻译 订阅多语言 价格 币种 汇率",
    payments: "支付配置 支付方式 支付接口",
    groups: "权限组管理 服务器",
    invitations: "邀请管理 佣金 审核 复核 邀请邮件",
    banners: "Banner 管理 轮播图",
    knowledge: "知识库管理 帮助中心",
    coupons: "优惠码 活动 发放 券包",
    nodes: "服务器 DDNS 域名 流量预算 Lightsail",
    clients: "FastAI 专用客户端 UA 最低版本 下载",
    "client-releases": "第三方客户端管理 推荐 下载",
    "log-subscribe": "订阅日志",
    "log-risk": "风控命中",
    "mail-logs": "邮件日志 退信 投诉 送达",
    "mail-blocklist": "邮件黑名单 禁发邮箱 风控与黑名单",
    "log-settings": "日志设置 清理 保留期",
    security: "账户安全 MFA TOTP 恢复码",
};
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
                usage: "users",
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
    const [navSearch, setNavSearch] = useState("");
    const searchInput = useRef<HTMLInputElement>(null);
    const mobileToggle = useRef<HTMLButtonElement>(null);
    const [offline, setOffline] = useState(() => !navigator.onLine);
    useEffect(() => {
        const update = () => setOffline(!navigator.onLine);
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    }, []);
    const canLeave = () =>
        !document.querySelector('[data-unsaved="true"]') ||
        window.confirm("有尚未保存的修改，确认离开当前页面？");
    const searchTerms = navSearch
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const visibleMenu = legacyAdminMenu.filter(([key, label, , group]) => {
        const searchable =
            `${key} ${label} ${group} ${adminMenuKeywords[key] || ""}`.toLowerCase();
        return searchTerms.every((term) => searchable.includes(term));
    });
    const [open, setOpen] = useState(false);
    const [menu, setMenu] = useState(false);
    useEffect(() => {
        setOpen(false);
        setMenu(false);
        setNavSearch("");
    }, [current]);
    useEffect(() => {
        const escape = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                if (
                    document.querySelector('[role="dialog"][aria-modal="true"]')
                )
                    return;
                e.preventDefault();
                setOpen(true);
                requestAnimationFrame(() => searchInput.current?.focus());
            }
            if (e.key === "Escape") {
                setMenu(false);
                setOpen(false);
                if (document.activeElement?.closest("#sidebar"))
                    mobileToggle.current?.focus();
            }
        };
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("keydown", escape);
        };
    }, []);
    const title =
        legacyAdminMenu.find(
            ([key]) =>
                key === (current === "operations" ? "overview" : current),
        )?.[1] ||
        (
            {
                system: "系统状态",
                operations: "运营概览",
                clients: "访问与版本策略",
                translations: "套餐翻译",
                "risk-settings": "日志与保留策略",
                ddns: "动态域名",
            } as Record<string, string>
        )[current] ||
        "页面未找到";
    const group = legacyAdminMenu.find(([key]) => key === current)?.[3];
    return (
        <div
            id="page-container"
            className={`admin-shell ${open ? "admin-nav-open" : ""}`}
            onClickCapture={(event) => {
                const anchor = (
                    event.target as HTMLElement
                ).closest<HTMLAnchorElement>("a[href]");
                if (
                    !anchor ||
                    anchor.target === "_blank" ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey ||
                    event.altKey ||
                    anchor.getAttribute("href")?.startsWith("#")
                )
                    return;
                if (anchor.href !== location.href && !canLeave()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
        >
            <a
                className="admin-skip-link"
                href="#admin-main-content"
                onClick={(event) => {
                    event.preventDefault();
                    const main = document.getElementById("admin-main-content");
                    main?.focus();
                    main?.scrollIntoView({ block: "start" });
                }}
            >
                跳转到页面内容
            </a>
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
                        <li className="admin-nav-search">
                            <input
                                ref={searchInput}
                                type="search"
                                aria-keyshortcuts="Control+k Meta+k"
                                aria-label="搜索后台功能"
                                placeholder="搜索功能… Ctrl / ⌘ K"
                                value={navSearch}
                                onChange={(e) => setNavSearch(e.target.value)}
                            />
                        </li>
                        {visibleMenu.length === 0 && (
                            <li className="admin-nav-empty" role="status">
                                没有匹配的功能
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNavSearch("");
                                        searchInput.current?.focus();
                                    }}
                                >
                                    清除搜索
                                </button>
                            </li>
                        )}
                        {visibleMenu.map(([key, label, icon, group], i) => (
                            <li key={key} className="nav-main-item">
                                {group && group !== visibleMenu[i - 1]?.[3] && (
                                    <div className="nav-main-heading">
                                        {group}
                                    </div>
                                )}
                                <a
                                    className={`nav-main-link ${(current === "operations" ? "overview" : current) === key ? "active" : ""}`}
                                    aria-current={
                                        (current === "operations"
                                            ? "overview"
                                            : current) === key
                                            ? "page"
                                            : undefined
                                    }
                                    href={`#/${key}`}
                                >
                                    <AdminIcon
                                        name={icon}
                                        className="nav-main-link-icon"
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
                        className="admin-mobile-toggle"
                        ref={mobileToggle}
                        aria-controls="sidebar"
                        aria-label="打开导航"
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                    >
                        <Menu size={20} aria-hidden="true" />
                    </button>
                    <div className="admin-page-heading">
                        {group && (
                            <span className="admin-page-group">{group}</span>
                        )}
                        <h1 className="v2board-container-title">{title}</h1>
                    </div>
                    <div className="admin-header-actions">
                        <DropdownMenu.Root
                            open={menu}
                            onOpenChange={setMenu}
                            modal={false}
                        >
                            <div className="admin-account">
                                <DropdownMenu.Trigger asChild>
                                    <button
                                        className="admin-account-trigger"
                                        aria-label="账户菜单"
                                        id="page-header-user-dropdown"
                                    >
                                        <CircleUser
                                            size={20}
                                            aria-hidden="true"
                                        />
                                        <span className="admin-account-email">
                                            {user.email}
                                        </span>
                                        <ChevronDown
                                            size={16}
                                            aria-hidden="true"
                                        />
                                    </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Portal>
                                    <DropdownMenu.Content
                                        className="admin-account-menu"
                                        align="end"
                                        sideOffset={8}
                                        collisionPadding={12}
                                    >
                                        <DropdownMenu.Item asChild>
                                            <a
                                                className="admin-account-item"
                                                href="/"
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                用户端
                                            </a>
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item asChild>
                                            <a
                                                className="admin-account-item"
                                                href="#/security"
                                            >
                                                账户安全
                                            </a>
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item
                                            className="admin-account-item"
                                            onSelect={(event) => {
                                                if (!canLeave()) {
                                                    event.preventDefault();
                                                    return;
                                                }
                                                logout();
                                            }}
                                        >
                                            登出
                                            <LogOut
                                                size={16}
                                                aria-hidden="true"
                                            />
                                        </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                            </div>
                        </DropdownMenu.Root>
                    </div>
                </div>
            </header>
            <main id="main-container">
                <div
                    id="admin-main-content"
                    tabIndex={-1}
                    className="admin-content"
                    data-page={current}
                >
                    {offline && (
                        <div className="alert" role="status">
                            网络连接已断开。页面上的数据可能不是最新状态，请恢复网络后刷新；提交失败时请先核查记录再重试。
                        </div>
                    )}
                    {children}
                </div>
            </main>
        </div>
    );
}
