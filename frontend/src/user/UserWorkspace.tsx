import {
    AnalyticsPrivacyFooter,
    PrivacyFooterLinks,
} from "./AnalyticsPrivacy";
import { displayTimeZone } from "../shared/timezone";
import {
    initializeBrowserSession,
    hasBrowserSession,
    forgetBrowserSession,
} from "../shared/browser-session";
import DOMPurify from "dompurify";
import { installChatLayout } from "./chat-layout";
import {
    tx,
    locale,
    setLanguagePersistence,
    applyAccountLanguage,
} from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import {
    Sparkles,
    LayoutDashboard,
    Globe,
    ShoppingBag,
    ReceiptText,
    BookOpen,
    Gift,
    LogOut,
    Menu,
    ChevronRight,
    MonitorSmartphone,
    X,
} from "lucide-react";
import {
    boot,
    request,
    navigate,
    readRequest,
    clearReadCache,
    logoutSession,
    type Row,
} from "../shared/api";

import { UserAuth } from "./UserAuth";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { UserStatusGate } from "./AccountEntry";
import { AnnouncementCenter } from "./AnnouncementCenter";
import { InviteCampaign } from "./InviteCampaign";
import { AccountMenu } from "./AccountMenu";

import { clearCheckoutPayment, purchaseReturnPath } from "./checkout-navigation";
import { browserReturnPath } from "../shared/browser-access";
import { userNavigation } from "./user-navigation";
import {
    WorkspaceSkeleton,
    LandingSkeleton,
} from "../shared/WorkspaceSkeleton";
const loadUserContent = () => import("./user-entry");
const UserContent = React.lazy(loadUserContent);
const ClientAuthorization = React.lazy(() => import("./ClientAuthorization"));
const Landing = React.lazy(() => import("./Landing"));
import { useTranslation } from "react-i18next";
import { LanguagePicker } from "../shared/LanguagePicker";
export default function UserWorkspace() {
    useEffect(() => {
        setLanguagePersistence(async (language) => {
            if (!hasBrowserSession()) return false;
            await request("user/update", { language });
            return true;
        });
        return () => setLanguagePersistence(async () => false);
    }, []);
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
    const [sessionAttempt, setSessionAttempt] = useState(0);
    const [sessionRevision, setSessionRevision] = useState(0);
    const [sessionError, setSessionError] = useState(false);
    const [sessionRetryAt, setSessionRetryAt] = useState(0);
    const retryIn = useRetryCountdown(sessionRetryAt);
    const [languagePending, setLanguagePending] = useState(false);
    const [languageBusy, setLanguageBusy] = useState(false);
    const languageRequest = useRef(0);
    useEffect(() => () => { languageRequest.current += 1; }, [user?.id]);
    useEffect(() => {
        if (sessionError) document.getElementById("session-recovery-title")?.focus();
    }, [sessionError]);
    async function retryLanguage() {
        if (!user || languageBusy) return;
        const attempt = ++languageRequest.current;
        setLanguageBusy(true);
        try {
            await applyAccountLanguage(user.language);
            if (attempt === languageRequest.current) setLanguagePending(false);
        } catch {
            // Keep the current interface language and authenticated workspace available.
        } finally {
            if (attempt === languageRequest.current) setLanguageBusy(false);
        }
    }
    const [mobile, setMobile] = useState(
        () => matchMedia("(max-width: 800px)").matches,
    );
    const sidebar = useRef<HTMLElement>(null);
    const loggingOut = useRef(false);
    const sessionEpoch = useRef(0);
    // Resume only validated local pages; never accept arbitrary return URLs or credentials.
    const purchaseReturn = useRef<string | undefined>(purchaseReturnPath(location.hash) ?? browserReturnPath(location.href));
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
        sessionEpoch.current += 1;
        setSessionRevision((revision) => revision + 1);
        clearCheckoutPayment();
        languageRequest.current += 1;
        setLanguagePending(false);
        setLanguageBusy(false);
        try {
            await logoutSession();
            purchaseReturn.current = undefined;
            setUser(null);
            navigate("login");
        } catch (reason) {
            setUser(null);
            setError((reason as Error).message);
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
        const openedAtPath = location.hash.slice(2).split("?")[0];
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
            if (location.hash.slice(2).split("?")[0] === openedAtPath)
                previousFocus?.focus();
        };
    }, [open]);
    useEffect(() => {
        let active = true;
        setSessionError(false);
        setSessionRetryAt(0);
        setLoading(!boot.landing);
        const fn = () => {
            const current = location.hash.slice(2).split("?")[0];
            if (!["login", "register", "forget"].includes(current))
                purchaseReturn.current = purchaseReturnPath(location.hash) ?? browserReturnPath(location.href);
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
            sessionEpoch.current += 1;
            setSessionRevision((revision) => revision + 1);
            purchaseReturn.current = purchaseReturnPath(location.hash) ?? browserReturnPath(location.href) ?? purchaseReturn.current;
            clearCheckoutPayment();
            active = false;
            setLoading(false);
            clearReadCache();
            setUser(null);
            setSessionError(false);
            setLanguagePending(false);
            languageRequest.current += 1;
            setLanguageBusy(false);
            if (location.hash.startsWith("#/client-authorize?")) {
                setPath("client-authorize");
            } else {
                setPath("login");
                navigate("login");
            }
        };
        window.addEventListener("hashchange", fn);
        window.addEventListener("auth-expired", expire);
        if (boot.landing && location.hash.startsWith("#/"))
            location.replace("/app" + location.hash);
        const verification =
            !boot.landing
                ? new URLSearchParams(location.hash.split("?")[1]).get("verify")
                : null;
        if (verification) {
            history.replaceState(
                null,
                "",
                location.pathname + location.search + "#/login",
            );
            clearReadCache();
            forgetBrowserSession();
        }
        // Start code loading alongside the account request; do not delay authentication on it.
        if (!boot.landing && hasBrowserSession())
            void loadUserContent().catch(() => {});
        if (!boot.landing)
            initializeBrowserSession()
                .then(async () => {
                    if (!active || (!verification && !hasBrowserSession())) return null;
                    if (verification) {
                        await request("passport/auth/token2Login", {
                            verify: verification,
                        });
                    }
                    return readRequest(
                        "user/info",
                        undefined,
                        Boolean(verification) || sessionAttempt > 0,
                    );
                })
                .then(async (r) => {
                    if (!r || !active) return;
                    try {
                        await applyAccountLanguage(r.data.language);
                        if (active) setLanguagePending(false);
                    } catch {
                        if (active) setLanguagePending(true);
                    }
                    if (!active) return;
                    setUser(r.data);
                    if (verification) {
                        setPath("dashboard");
                        navigate("dashboard");
                    }
                })
                .catch((e) => {
                    if (!active) return;
                    if (e.status === 401 || e.code === "SESSION_CHANGED") {
                        forgetBrowserSession();
                        expire();
                        return;
                    }
                    // A read failure is not evidence that the server session expired.
                    setSessionError(true);
                    if (e.status === 429)
                        setSessionRetryAt(Date.now() + Math.max(1, Number(e.retryAfter) || 60) * 1000);
                })
                .finally(() => { if (active) setLoading(false); });
        else setLoading(false);
        return () => {
            active = false;
            window.removeEventListener("hashchange", fn);
            window.removeEventListener("auth-expired", expire);
        };
    }, [sessionAttempt]);
    if (boot.landing)
        return (
            <React.Suspense fallback={<LandingSkeleton />}>
                <Landing />
            </React.Suspense>
        );
    if (loading) return <WorkspaceSkeleton full />;
    if (sessionError)
        return (
            <div className="access-page">
                <div className="auth-language"><LanguagePicker /></div>
                <section className="session-recovery" aria-labelledby="session-recovery-title">
                    <h1 id="session-recovery-title" tabIndex={-1}>{tx("页面暂时无法加载")}</h1>
                    <p role="alert">{tx("accountLoadFailed", { ns: "experience" })}</p>
                    <button type="button" className="primary" disabled={retryIn > 0}
                        onClick={() => setSessionAttempt((attempt) => attempt + 1)}>
                        {retryIn > 0 ? tx("retryIn", { ns: "pricing", seconds: retryIn }) : tx("重试")}
                    </button>
                </section>
                <AnalyticsPrivacyFooter />
            </div>
        );
    if (!user) {
        const loginEpoch = sessionRevision;
        return (
            <div className="access-page">
                <div className="auth-language">
                    <LanguagePicker />
                </div>
                {error && <div className="alert">{error}</div>}
                <UserAuth
                    key={path}
                    mode={
                        ["register", "forget"].includes(path) ? path : "login"
                    }
                    onLogin={(account, options) => {
                        if (loginEpoch !== sessionEpoch.current) return false;
                        setUser(account);
                        setLanguagePending(!!options?.languagePending);
                    }}
                    redirectPath={
                        authorizationReturn.current ?? purchaseReturn.current
                    }
                />
                <AnalyticsPrivacyFooter />
            </div>
        );
    }
    if (path === "client-authorize")
        return (
            <div className="access-page">
                <React.Suspense fallback={<WorkspaceSkeleton full />}>
                    <ClientAuthorization user={user} />
                </React.Suspense>
                <AnalyticsPrivacyFooter />
            </div>
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
                activities: Gift,
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
            { key: "coupons", label: "我的优惠券" },
            { key: "activities", label: "活动中心" },
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
            current === "ticket"
                ? "knowledge"
                : ["security", "notifications"].includes(current)
                  ? "profile"
                  : current === "traffic" &&
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
        <ErrorBoundary key={path} message={tx("pageRecovery", { ns: "experience" })}>
            <React.Suspense fallback={<WorkspaceSkeleton />}>
                <UserContent current={current} path={path} />
            </React.Suspense>
        </ErrorBoundary>
    );
    return (
        <UserStatusGate
            onStatus={setUser}
            logout={handleLogout}
            fallbackFooter={<AnalyticsPrivacyFooter />}
            support={
                <React.Suspense fallback={<WorkspaceSkeleton />}>
                    <UserContent current="ticket" path="ticket" />
                </React.Suspense>
            }
        >
            <div className="app user">
                <WorkspaceNavigation path={path} title={tx(item?.label || "总览")} inert={mobile && open} />
                {open && (
                    <div
                        className="nav-backdrop"
                        onClick={() => setOpen(false)}
                    />
                )}
                <aside
                    id="user-primary-navigation"
                    ref={sidebar}
                    inert={mobile && !open}
                    role={mobile && open ? "dialog" : undefined}
                    aria-modal={mobile && open ? true : undefined}
                    aria-label={tx("工作空间")}
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
                                aria-controls="user-primary-navigation"
                                onClick={() => setOpen(!open)}
                            >
                                <Menu />
                            </button>
                            <span>{tx("工作空间")}</span>
                            <ChevronRight size={14} />
                            <strong>{tx(item?.label || "总览")}</strong>
                        </div>
                        <div className="actions header-controls">
                            <LanguagePicker />
                            <AnnouncementCenter />
                            <AccountMenu user={user} logout={handleLogout} />
                        </div>
                    </header>
                    <main id="workspace-main" tabIndex={-1} aria-label={tx(item?.label || "总览")}>
                        {languagePending && (
                            <div className="language-recovery" role="status">
                                <span>{tx("languageLoadFailed", { ns: "experience" })}</span>
                                <button type="button" disabled={languageBusy} onClick={retryLanguage}>
                                    {tx(languageBusy ? "正在加载…" : "重试")}
                                </button>
                            </div>
                        )}
                        {!path.startsWith("order/") && (
                            <div className="page-heading">
                                <div>
                                    <span className="eyebrow">
                                        {tx("工作空间")}
                                    </span>
                                    <h1>{tx(item?.label || "总览")}</h1>
                                </div>
                                <span className="today">
                                    {new Date().toLocaleDateString(locale(), {
                                        timeZone: displayTimeZone(),
                                        month: "long",
                                        day: "numeric",
                                        weekday: "long",
                                    })}
                                </span>
                            </div>
                        )}
                        <div className="user-page-content">{content}</div>
                        <footer className="page-footer workspace-footer">
                            <div className="workspace-footer-brand">
                                {boot.title}
                                <span>{tx("简洁连接，无限可能。")}</span>
                            </div>
                            <PrivacyFooterLinks />
                        </footer>
                    </main>
                </div>
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
                                    "activities",
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
            </div>
        </UserStatusGate>
    );
}

function WorkspaceNavigation({ path, title, inert }: { path: string; title: string; inert: boolean }) {
    const initialTitle = useRef(document.title);
    const previousPath = useRef(path);
    useEffect(() => {
        document.title = `${title} · ${boot.title}`;
    }, [title]);
    useEffect(() => () => { document.title = initialTitle.current; }, []);
    useEffect(() => {
        if (previousPath.current !== path) {
            document.getElementById("workspace-main")?.focus({ preventScroll: true });
            previousPath.current = path;
        }
    }, [path]);
    return (
        <a className="product-skip" href="#workspace-main" inert={inert} onClick={(event) => {
            // This app uses hash routing: a skip action must not change the route.
            event.preventDefault();
            const main = document.getElementById("workspace-main");
            main?.focus({ preventScroll: true });
            main?.scrollIntoView({ block: "start", behavior: "instant" });
        }}>
            {tx("skip", { ns: "landing" })}
        </a>
    );
}
