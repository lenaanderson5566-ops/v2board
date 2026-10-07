import { Captcha } from "../shared/Captcha";
import DOMPurify from "dompurify";
import { installChatLayout } from "./chat-layout";
import {
    tx,
    locale,
    setLanguagePersistence,
    applyAccountLanguage,
} from "../shared/i18n";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
    Sparkles,
    LayoutDashboard,
    Globe,
    ShoppingBag,
    ReceiptText,
    BookOpen,
    Users,
    Settings,
    Shield,
    Network,
    ScrollText,
    Languages,
    CreditCard,
    Gift,
    Ticket,
    LogOut,
    Menu,
    ArrowUpRight,
    ChevronRight,
    Activity,
    MonitorSmartphone,
    Bell,
    Route,
    Layers,
    Server,
    X,
} from "lucide-react";
import {
    boot,
    request,
    storageKey,
    navigate,
    readRequest,
    clearReadCache,
    logoutSession,
    type Row,
} from "../shared/api";
import { Editor, Panel, type Field } from "../shared/ui";
import { UserAuth } from "./UserAuth";
import { UserStatusGate } from "./AccountEntry";
import { AnnouncementCenter } from "./AnnouncementCenter";
import { InviteCampaign } from "./InviteCampaign";
import { AccountMenu } from "./AccountMenu";
import { EmbeddedBrowserNotice } from "./EmbeddedBrowserNotice";
import { currentDevice } from "../shared/user-experience";
import { userNavigation } from "./user-navigation";
import {
    WorkspaceSkeleton,
    LandingSkeleton,
} from "../shared/WorkspaceSkeleton";
setLanguagePersistence(async (language) => {
    if (boot.mode !== "user" || !localStorage.getItem(storageKey)) return false;
    await request("user/update", { language });
    return true;
});
const loadUserContent = () => import("./user-entry");
const UserContent = React.lazy(loadUserContent);
const ClientAuthorization = React.lazy(() => import("./ClientAuthorization"));
const Landing = React.lazy(() => import("./Landing"));
import "../shared/style.css";
import "../shared/console.css";
import { useTranslation } from "react-i18next";
import { LanguagePicker } from "../shared/LanguagePicker";
import "./user-experience.css";
import "./product.css";
export default function UserApp() {
    useEffect(() => {
        if (
            boot.landing ||
            !boot.footerHtml ||
            document.getElementById("custom-footer")
        )
            return;
        const footer = document.createElement("footer");
        footer.id = "custom-footer";
        footer.innerHTML = DOMPurify.sanitize(boot.footerHtml);
        document.body.appendChild(footer);
        return () => footer.remove();
    }, []);
    useEffect(() => installChatLayout(), []);
    useTranslation();
    const [path, setPath] = useState(
            location.hash.slice(2).split("?")[0] || "",
        ),
        [user, setUser] = useState<Row | null>(null),
        [loading, setLoading] = useState(true),
        [open, setOpen] = useState(false),
        [error, setError] = useState("");
    const [mobile, setMobile] = useState(
        () => matchMedia("(max-width: 800px)").matches,
    );
    const sidebar = useRef<HTMLElement>(null);
    const loggingOut = useRef(false);
    const authorizationReturn = useRef<string | undefined>(
        /^#\/client-authorize\?authorizationId=[a-f0-9]{64}$/.test(
            location.hash,
        )
            ? location.hash.slice(2)
            : undefined,
    );
    async function handleLogout() {
        if (loggingOut.current) return;
        loggingOut.current = true;
        try {
            await logoutSession();
            setUser(null);
            navigate("login");
        } finally {
            loggingOut.current = false;
        }
    }
    useEffect(() => {
        const media = matchMedia("(max-width: 800px)");
        const update = () => {
            setMobile(media.matches);
            if (!media.matches) setOpen(false);
        };
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    }, [path]);
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        const previousFocus = document.activeElement as HTMLElement | null;
        document.body.style.overflow = "hidden";
        sidebar.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Tab") {
                const items = [
                    ...(sidebar.current?.querySelectorAll<HTMLElement>(
                        "button, a[href]",
                    ) || []),
                ];
                const first = items[0],
                    last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        };
        window.addEventListener("keydown", escape);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener("keydown", escape);
            previousFocus?.focus();
        };
    }, [open]);
    useEffect(() => {
        const fn = () => {
            const current = location.hash.slice(2).split("?")[0];
            if (
                /^#\/client-authorize\?authorizationId=[a-f0-9]{64}$/.test(
                    location.hash,
                )
            )
                authorizationReturn.current = location.hash.slice(2);
            else if (
                !["login", "register", "forget", "client-authorize"].includes(
                    current,
                )
            )
                authorizationReturn.current = undefined;
            setPath(location.hash.slice(2).split("?")[0] || "");
            setOpen(false);
        };
        const expire = () => {
            setUser(null);
            if (location.hash.startsWith("#/client-authorize?")) {
                setPath("client-authorize");
            } else {
                setPath("login");
                navigate("login");
            }
        };
        window.addEventListener("hashchange", fn);
        window.addEventListener("auth-expired", expire);
        if (boot.mode === "user" && currentDevice().embedded) {
            setLoading(false);
            return;
        }
        if (boot.landing && location.hash.startsWith("#/"))
            location.replace("/app" + location.hash);
        const verification =
            boot.mode === "user" && !boot.landing
                ? new URLSearchParams(location.hash.split("?")[1]).get("verify")
                : null;
        if (verification) {
            history.replaceState(
                null,
                "",
                location.pathname + location.search + "#/login",
            );
            clearReadCache();
            localStorage.removeItem(storageKey);
        }
        // Start code loading alongside the account request; do not delay authentication on it.
        if (
            boot.mode === "user" &&
            !boot.landing &&
            localStorage.getItem(storageKey)
        )
            void loadUserContent().catch(() => {});
        if (!boot.landing && (verification || localStorage.getItem(storageKey)))
            Promise.resolve()
                .then(async () => {
                    if (verification) {
                        const session = await request(
                            "passport/auth/token2Login",
                            { verify: verification },
                        );
                        if (typeof session.data?.auth_data !== "string")
                            throw new Error(
                                tx("服务响应异常 ({{value0}})", {
                                    value0: 200,
                                }),
                            );
                        localStorage.setItem(
                            storageKey,
                            session.data.auth_data,
                        );
                    }
                    return readRequest(
                        "user/info",
                        undefined,
                        Boolean(verification),
                    );
                })
                .then(async (r) => {
                    if (boot.mode === "user")
                        await applyAccountLanguage(r.data.language);
                    setUser(r.data);
                    if (verification) {
                        setPath("dashboard");
                        navigate("dashboard");
                    }
                })
                .catch((e) => {
                    setError(e.message);
                    localStorage.removeItem(storageKey);
                })
                .finally(() => setLoading(false));
        else setLoading(false);
        return () => {
            window.removeEventListener("hashchange", fn);
            window.removeEventListener("auth-expired", expire);
        };
    }, []);
    if (boot.mode === "user" && currentDevice().embedded)
        return <EmbeddedBrowserNotice />;
    if (boot.landing)
        return (
            <React.Suspense fallback={<LandingSkeleton />}>
                <Landing />
            </React.Suspense>
        );
    if (loading)
        return boot.mode === "user" ? (
            <WorkspaceSkeleton full />
        ) : (
            <div className="state full">
                <span className="spinner" />
                {tx("正在加载工作空间…")}
            </div>
        );
    if (!user)
        return (
            <>
                {boot.mode === "user" && (
                    <div className="auth-language">
                        <LanguagePicker />
                    </div>
                )}
                {error && <div className="alert">{error}</div>}
                <UserAuth
                    key={path}
                    mode={
                        ["register", "forget"].includes(path) ? path : "login"
                    }
                    onLogin={setUser}
                    redirectPath={authorizationReturn.current}
                    renderCaptcha={(handler) => <Captcha onChange={handler} />}
                />
            </>
        );
    if (path === "client-authorize")
        return (
            <React.Suspense fallback={<WorkspaceSkeleton full />}>
                <ClientAuthorization user={user} />
            </React.Suspense>
        );
    const userNav = userNavigation(user.account_status?.state).map((item) => ({
        ...item,
        icon: (
            {
                dashboard: LayoutDashboard,
                subscribe: MonitorSmartphone,
                plan: ShoppingBag,
                order: ReceiptText,
                knowledge: BookOpen,
            } as Record<string, typeof Globe>
        )[item.key],
    }));
    const nav = userNav,
        current = path.split("/")[0] || nav[0]?.key || "dashboard",
        item = [
            ...nav,
            { key: "order", label: "账单" },
            { key: "traffic", label: "使用情况" },
            { key: "invite", label: "邀请好友" },
            { key: "ticket", label: "工单支持" },
            { key: "security", label: "账户安全" },
            { key: "notifications", label: "通知设置" },
            { key: "profile", label: "账户设置" },
            {
                key: "plan",
                label:
                    user.account_status?.state === "active"
                        ? "管理订阅"
                        : "购买订阅",
            },
            { key: "subscribe", label: "配置中心" },
        ].find((n) => n.key === current),
        groups = [...new Set(nav.map((n) => n.group))],
        navigationCurrent =
            boot.mode === "user" && current === "ticket"
                ? "knowledge"
                : boot.mode === "user" &&
                    ["security", "notifications"].includes(current)
                  ? "profile"
                  : boot.mode === "user" &&
                      current === "traffic" &&
                      user.account_status?.state === "active"
                    ? "dashboard"
                    : current,
        mobileNavigationCurrent =
            ["order", "plan"].includes(current) &&
            user.account_status?.state === "active"
                ? "subscribe"
                : current === "order"
                  ? "plan"
                  : navigationCurrent;
    const content = (
        <React.Suspense fallback={<WorkspaceSkeleton />}>
            <UserContent current={current} path={path} />
        </React.Suspense>
    );
    return (
        <UserStatusGate
            onStatus={setUser}
            logout={handleLogout}
            support={
                <React.Suspense fallback={<WorkspaceSkeleton />}>
                    <UserContent current="ticket" path="ticket" />
                </React.Suspense>
            }
        >
            <div className={"app " + boot.mode}>
                {open && (
                    <div
                        className="nav-backdrop"
                        onClick={() => setOpen(false)}
                    />
                )}
                <aside
                    ref={sidebar}
                    inert={mobile && !open}
                    className={open ? "open" : ""}
                >
                    <button
                        className="drawer-close icon-button"
                        aria-label={tx("关闭")}
                        onClick={() => setOpen(false)}
                    >
                        <X size={19} />
                    </button>
                    <a className="brand" href="/">
                        <span className="brand-mark">
                            <Sparkles size={19} aria-hidden="true" />
                        </span>
                        <span>
                            {boot.title}
                            <small>{tx("用户工作空间")}</small>
                        </span>
                    </a>
                    <nav>
                        {groups.map((group) => (
                            <div className="nav-group" key={group}>
                                <small>{tx(group)}</small>
                                {nav
                                    .filter((n) => n.group === group)
                                    .map(({ key, label, icon: Icon }) => (
                                        <a
                                            aria-current={
                                                navigationCurrent === key
                                                    ? "page"
                                                    : undefined
                                            }
                                            className={
                                                navigationCurrent === key
                                                    ? "active"
                                                    : ""
                                            }
                                            href={"#/" + key}
                                            key={key}
                                        >
                                            <Icon size={18} />
                                            <span>{tx(label)}</span>
                                            {navigationCurrent === key && (
                                                <span className="nav-dot" />
                                            )}
                                        </a>
                                    ))}
                            </div>
                        ))}
                    </nav>
                    <InviteCampaign />
                    <div className="sidebar-bottom">
                        <div className="avatar">
                            {user.email?.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                            <strong>{user.email}</strong>
                            <small>{tx("个人账户")}</small>
                        </div>
                        <button
                            className="icon-button"
                            title={tx("退出登录")}
                            onClick={handleLogout}
                        >
                            <LogOut size={17} />
                        </button>
                    </div>
                </aside>
                <div className="main" inert={mobile && open}>
                    <header>
                        <div className="breadcrumb">
                            <button
                                className="mobile-menu icon-button"
                                aria-label={tx("打开导航")}
                                aria-expanded={open}
                                onClick={() => setOpen(!open)}
                            >
                                <Menu />
                            </button>
                            <span>{tx("工作空间")}</span>
                            <ChevronRight size={14} />
                            <strong>{tx(item?.label || "总览")}</strong>
                        </div>
                        <div className="actions header-controls">
                            {boot.mode === "user" && <LanguagePicker />}
                            {boot.mode === "user" && <AnnouncementCenter />}
                            <AccountMenu user={user} logout={handleLogout} />
                        </div>
                    </header>
                    <main>
                        <div className="page-heading">
                            <div>
                                <span className="eyebrow">WORKSPACE</span>
                                <h1>{tx(item?.label || "总览")}</h1>
                            </div>
                            <span className="today">
                                {new Date().toLocaleDateString(locale(), {
                                    month: "long",
                                    day: "numeric",
                                    weekday: "long",
                                })}
                            </span>
                        </div>
                        {content}
                        <div className="page-footer">
                            {boot.title}{" "}
                            <span>{tx("简洁连接，无限可能。")}</span>
                        </div>
                    </main>
                </div>
                {boot.mode === "user" && (
                    <nav
                        className="bottom-nav"
                        inert={mobile && open}
                        aria-label={tx("快捷导航")}
                    >
                        {userNav
                            .filter((n) =>
                                [
                                    "dashboard",
                                    "plan",
                                    "subscribe",
                                    "knowledge",
                                    "profile",
                                ].includes(n.key),
                            )
                            .map(({ key, label, icon: Icon }) => (
                                <a
                                    key={key}
                                    href={"#/" + key}
                                    aria-current={
                                        mobileNavigationCurrent === key
                                            ? "page"
                                            : undefined
                                    }
                                    className={
                                        mobileNavigationCurrent === key
                                            ? "active"
                                            : ""
                                    }
                                >
                                    <Icon size={21} />
                                    <span>{tx(label)}</span>
                                </a>
                            ))}
                    </nav>
                )}
            </div>
        </UserStatusGate>
    );
}
