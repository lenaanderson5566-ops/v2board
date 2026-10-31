import {
    Menu,
    XCircle,
    CircleUser,
    ChevronDown,
    LogOut,
    Search,
    X,
} from "lucide-react";
import { AdminIcon } from "./AdminIcon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { boot, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { adminWorkspace } from "./admin-navigation";
import { AdminDisplayTimeZoneDialog, useAdminDisplayTimeZone } from "./AdminDisplayTimeZone";
import "./admin-shell-experience.css";

// Stable menu order and canonical navigation; styling is owned by admin.css.
export const legacyAdminMenu = [
    ["overview", "仪表盘", "speedometer", "概览"],
    ["users", "用户管理", "users", "用户与支持"],
    ["online", "在线用户", "users", "用户与支持"],
    ["tickets", "工单管理", "support", "用户与支持"],
    ["knowledge", "知识库", "bulb", "用户与支持"],
    ["plans", "套餐与订阅", "bag", "套餐与支付"],
    ["orders", "订单管理", "list", "套餐与支付"],
    ["payments", "支付与充值", "credit-card", "套餐与支付"],
    ["coupons", "优惠券管理", "present", "营销与内容"],
    ["giftcards", "礼品卡管理", "star", "营销与内容"],
    ["invitations", "邀请与奖励", "users", "营销与内容"],
    ["notices", "公告管理", "speech", "营销与内容"],
    ["banners", "横幅管理", "picture", "营销与内容"],
    ["nodes", "节点管理", "layers", "节点与接入"],
    ["servers", "服务器管理", "layers", "节点与接入"],
    ["node-domains", "域名与解析", "shuffle", "节点与接入"],
    ["groups", "节点权限组", "wrench", "节点与接入"],
    ["routes", "路由管理", "shuffle", "节点与接入"],
    ["client-downloads", "专用客户端下载", "screen-smartphone", "客户端"],
    ["clients", "客户端访问与接入", "shield", "客户端"],
    ["client-releases", "第三方客户端", "screen-smartphone", "客户端"],
    ["account-settings", "账户与注册", "shield", "安全与风控"],
    ["risk", "风控规则", "shield", "安全与风控"],
    ["access-blacklist", "订阅访问黑名单", "ban", "安全与风控"],
    ["log-targets", "节点访问目标", "layers", "日志与诊断"],
    ["access-logs", "访问日志", "login", "日志与诊断"],
    ["mail-logs", "邮件发送日志", "notebook", "日志与诊断"],
    ["client-diagnostics", "客户端运行记录", "screen-smartphone", "日志与诊断"],
    ["system-log", "系统日志", "notebook", "日志与诊断"],
    ["log-settings", "采集与保留策略", "settings", "日志与诊断"],
    ["site-settings", "站点设置", "equalizer", "系统设置"],
    ["notification-settings", "通知设置", "speech", "系统设置"],
    ["dictionary", "字典维护", "notebook", "系统设置"],
] as const;
export function adminPage(path: string): string {
    return path || "overview";
}

export function AdminShell({
    current,
    page = current,
    user,
    children,
    logout,
}: {
    current: string;
    page?: string;
    user: Row;
    children: ReactNode;
    logout: () => void;
}) {
    const displayTimeZonePreference = useAdminDisplayTimeZone();
    const [showTimeZone, setShowTimeZone] = useState(false);
    const timeZoneOpening = useRef(false);
    const accountTrigger = useRef<HTMLButtonElement>(null);
    const mobileToggle = useRef<HTMLButtonElement>(null);
    const sidebar = useRef<HTMLElement>(null);
    const searchInput = useRef<HTMLInputElement>(null);
    const currentPage = useRef(page);
    currentPage.current = page;
    const [search, setSearch] = useState("");
    const [mobile, setMobile] = useState(() =>
        typeof window.matchMedia === "function"
            ? window.matchMedia("(max-width: 991px)").matches
            : window.innerWidth < 992,
    );
    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const query = window.matchMedia("(max-width: 991px)");
        const changed = () => {
            setMobile(query.matches);
            if (!query.matches) setOpen(false);
        };
        query.addEventListener("change", changed);
        return () => query.removeEventListener("change", changed);
    }, []);
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
    const [open, setOpen] = useState(false);
    const [menu, setMenu] = useState(false);
    useEffect(() => {
        setOpen(false);
        setMenu(false);
        setSearch("");
    }, [current, page]);
    useEffect(() => {
        if (!mobile || !open) return;
        const previousOverflow = document.body.style.overflow;
        const openedPage = page;
        document.body.style.overflow = "hidden";
        searchInput.current?.focus();
        const trap = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const targets = Array.from(
                sidebar.current?.querySelectorAll<HTMLElement>("*") || [],
            ).filter((target) =>
                target.matches(
                    "a[href],button:not(:disabled),input:not(:disabled)",
                ),
            );
            const first = targets[0],
                last = targets.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener("keydown", trap);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", trap);
            if (currentPage.current === openedPage)
                mobileToggle.current?.focus();
        };
    }, [mobile, open]);
    useEffect(() => {
        const escape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setMenu(false);
                setOpen(false);
            }
        };
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("keydown", escape);
        };
    }, []);
    const rootTitle =
        legacyAdminMenu.find(
            ([key]) =>
                key ===
                ([
                    "overview-risk",
                    "overview-analytics",
                    "overview-system",
                ].includes(current)
                    ? "overview"
                    : current),
        )?.[1] ||
        (
            {
                system: "系统状态",
                operations: "运营概览",
                clients: "访问与版本策略",
                translations: "套餐翻译",
                security: "管理员账户安全",
                ddns: "动态域名",
            } as Record<string, string>
        )[current] ||
        "页面未找到";
    const group = legacyAdminMenu.find(([key]) => key === current)?.[3];
    const tab = adminWorkspace(page)?.tabs.find(
        ([route]) => route === page,
    )?.[1];
    const title =
        page !== current
            ? tab ||
              (
                  {
                      "overview-risk": "风控概览",
                      "overview-analytics": "经营分析",
                      "overview-system": "系统状态",
                      "plans-translations": "套餐翻译",
                  } as Record<string, string>
              )[page] ||
              rootTitle
            : rootTitle;
    const previousPage = useRef(page);
    const initialTitle = useRef(document.title);
    useEffect(() => {
        document.title = `${title} · ${boot.title}`;
        if (previousPage.current !== page)
            document
                .getElementById("admin-main-content")
                ?.focus({ preventScroll: true });
        previousPage.current = page;
    }, [page, title]);
    useEffect(
        () => () => {
            document.title = initialTitle.current;
        },
        [],
    );
    const term = search.trim().toLocaleLowerCase();
    const navigation = legacyAdminMenu.flatMap(([key, label, icon, group]) => {
        const entry = {
            key: String(key),
            label: String(label),
            icon,
            group,
            parent: "",
        };
        if (!term) return [entry];
        return [
            entry,
            ...(adminWorkspace(key)
                ?.tabs.filter(([route]) => route !== key)
                .map(([route, child]) => ({
                    ...entry,
                    key: route,
                    label: child,
                    parent: label,
                })) || []),
        ].filter((item) =>
            `${item.label} ${item.parent} ${item.group} ${item.key}`
                .toLocaleLowerCase()
                .includes(term),
        );
    });
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
                inert={mobile && open}
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
            <nav
                id="sidebar"
                ref={sidebar}
                aria-label="后台导航"
                inert={mobile && !open}
                role={mobile && open ? "dialog" : undefined}
                aria-modal={mobile && open ? true : undefined}
            >
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
                <div className="admin-navigation-search">
                    <label>
                        <Search size={16} aria-hidden="true" />
                        <input
                            ref={searchInput}
                            type="search"
                            value={search}
                            aria-label={tx("搜索后台页面")}
                            placeholder={tx("输入页面名称或分组")}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </label>
                    {search && (
                        <button
                            type="button"
                            aria-label={tx("清除页面搜索")}
                            onClick={() => {
                                setSearch("");
                                searchInput.current?.focus();
                            }}
                        >
                            <X size={15} aria-hidden="true" />
                        </button>
                    )}
                </div>
                <div className="content-side">
                    <ul className="nav-main">
                        {navigation.map(
                            ({ key, label, icon, group, parent }, i) => (
                                <li key={key} className="nav-main-item">
                                    {group &&
                                        group !== navigation[i - 1]?.group && (
                                            <div className="nav-main-heading">
                                                {group}
                                            </div>
                                        )}
                                    <a
                                        className={`nav-main-link ${parent ? "is-subpage " : ""}${(term ? page : ["overview-risk", "overview-analytics", "overview-system"].includes(current) ? "overview" : current) === key ? "active" : ""}`}
                                        aria-current={
                                            (term
                                                ? page
                                                : [
                                                        "overview-risk",
                                                        "overview-analytics",
                                                        "overview-system",
                                                    ].includes(current)
                                                  ? "overview"
                                                  : current) === key
                                                ? "page"
                                                : undefined
                                        }
                                        href={`#/${key}`}
                                        onClick={() => {
                                            if (page === key) setOpen(false);
                                        }}
                                    >
                                        <AdminIcon
                                            name={icon}
                                            className="nav-main-link-icon"
                                        />
                                        <span className="nav-main-link-name">
                                            {label}
                                            {parent && <small>{parent}</small>}
                                        </span>
                                    </a>
                                </li>
                            ),
                        )}
                    </ul>
                    {term && navigation.length === 0 && (
                        <p className="admin-navigation-empty" role="status">
                            {tx("未找到匹配页面，请尝试其他关键词。")}
                        </p>
                    )}
                </div>
                <div className="v2board-copyright">{boot.title}</div>
            </nav>
            <header id="page-header" inert={mobile && open}>
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
                            <span className="admin-page-group">
                                {group}
                                {title !== rootTitle ? ` / ${rootTitle}` : ""}
                            </span>
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
                                        ref={accountTrigger}
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
                                        onCloseAutoFocus={event => {
                                            if (timeZoneOpening.current) event.preventDefault();
                                        }}
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
                                        {displayTimeZonePreference && <DropdownMenu.Item
                                            className="admin-account-item"
                                            onSelect={() => {
                                                timeZoneOpening.current = true;
                                                accountTrigger.current?.focus();
                                                setShowTimeZone(true);
                                            }}
                                        >界面显示时区</DropdownMenu.Item>}
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
            <main id="main-container" inert={mobile && open}>
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
            {showTimeZone && <AdminDisplayTimeZoneDialog close={() => {
                timeZoneOpening.current = false;
                setShowTimeZone(false);
            }} />}
        </div>
    );
}
