import {
    tx,
    locale,
    setLanguagePersistence,
    applyAccountLanguage,
} from "./i18n";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
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
    admin,
    readRequest,
    clearReadCache,
    logoutSession,
    type Row,
} from "./api";
import { Editor, Panel, type Field } from "./ui";
import { UserAuth } from "./UserAuth";
import { UserStatusGate } from "./AccountEntry";
import { AnnouncementCenter } from "./AnnouncementCenter";
import { InviteCampaign } from "./InviteCampaign";
import { AccountMenu } from "./AccountMenu";
import { EmbeddedBrowserNotice } from "./EmbeddedBrowserNotice";
import { currentDevice } from "./user-experience";
import { userNavigation } from "./user-navigation";
import { WorkspaceSkeleton, LandingSkeleton } from "./WorkspaceSkeleton";
setLanguagePersistence(async (language) => {
    if (boot.mode !== "user" || !localStorage.getItem(storageKey)) return false;
    await request("user/update", { language });
    return true;
});
const UserContent = React.lazy(() => import("./user-entry"));
const AdminContent = React.lazy(() => import("./admin-entry"));
const Landing = React.lazy(() => import("./Landing"));
import "./style.css";
import "./console.css";
import { useTranslation } from "react-i18next";
import { LanguagePicker } from "./LanguagePicker";
import { AdminShell, adminPage, legacyAdminMenu } from "./admin-shell";
import "./admin-legacy.css";
import "./user-experience.css";
import "./product.css";
type Nav = { key: string; label: string; icon: typeof Globe; group: string };
const adminNav: Nav[] = legacyAdminMenu.map(([key, label, , group]) => ({
    key,
    label,
    group,
    icon: LayoutDashboard,
}));
function Auth({
    mode,
    onLogin,
}: {
    mode: string;
    onLogin: (user: Row) => void;
}) {
    const register = mode === "register" && boot.mode === "user",
        forget = mode === "forget";
    const [captcha, setCaptcha] = useState(""),
        [mailError, setMailError] = useState(""),
        [sending, setSending] = useState(false),
        [cooldown, setCooldown] = useState(0);
    const formRef = useRef<HTMLDivElement>(null);
    const fields: Field[] = [
        {
            key: "email",
            label: tx("邮箱地址"),
            type: "email",
            autoComplete: "email",
            required: true,
        },
        {
            key: "password",
            label: forget ? tx("新密码") : tx("密码"),
            type: "password",
            autoComplete:
                register || forget ? "new-password" : "current-password",
            required: true,
        },
        ...(register
            ? [{ key: "invite_code", label: tx("邀请码（可选）") } as Field]
            : []),
        ...(forget || (register && boot.emailVerify)
            ? [
                  {
                      key: "email_code",
                      label: tx("邮箱验证码"),
                      required: true,
                  } as Field,
              ]
            : []),
    ];
    useEffect(() => {
        if (!cooldown) return;
        const t = setTimeout(() => setCooldown((v) => v - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);
    return (
        <div className="auth-layout">
            <section className="auth-brand">
                <a className="brand" href="/">
                    <span className="brand-mark">
                        <Sparkles size={19} aria-hidden="true" />
                    </span>
                    {boot.title}
                </a>
                <div>
                    <span className="eyebrow">A BETTER WAY TO CONNECT</span>
                    <h1>
                        {tx("更自由的连接。")}
                        <br />
                        {tx("更简单的体验。")}
                    </h1>
                    <p>
                        {boot.description ||
                            tx("你的网络服务，在一个地方轻松管理。")}
                    </p>
                    <div className="auth-orbits">
                        <Globe size={160} strokeWidth={0.65} />
                    </div>
                </div>
                <small>{tx("连接 · 探索 · 发现")}</small>
            </section>
            <section className="auth-form">
                <div className="auth-box" ref={formRef}>
                    <span className="eyebrow">
                        {boot.mode === "admin" ? "ADMIN CONSOLE" : "WELCOME"}
                    </span>
                    <h2>
                        {forget
                            ? tx("重置密码")
                            : register
                              ? tx("创建账户")
                              : boot.mode === "admin"
                                ? boot.title
                                : tx("欢迎回来")}
                    </h2>
                    <p className="muted">
                        {boot.mode === "admin"
                            ? tx("登录统一管理后台")
                            : forget
                              ? tx("使用邮箱验证码设置新密码")
                              : tx("登录以管理你的订阅与账户")}
                    </p>
                    <Editor
                        key={mode}
                        fields={
                            boot.mode === "admin"
                                ? fields.map((field) => ({
                                      ...field,
                                      placeholder: field.label,
                                  }))
                                : fields
                        }
                        initial={{
                            invite_code:
                                new URLSearchParams(
                                    location.hash.split("?")[1],
                                ).get("code") || "",
                        }}
                        submit={
                            forget
                                ? tx("重置密码")
                                : register
                                  ? tx("注册账户")
                                  : tx("登录")
                        }
                        onSave={async (body) => {
                            if (boot.recaptchaSiteKey && !captcha)
                                throw new Error(tx("请先完成安全验证"));
                            if (forget) {
                                await request("passport/auth/forget", {
                                    ...body,
                                    recaptcha_data: captcha,
                                });
                                navigate("login");
                                return;
                            }
                            if (register)
                                await request("passport/auth/register", {
                                    ...body,
                                    recaptcha_data: captcha,
                                });
                            const r = await request("passport/auth/login", {
                                email: body.email,
                                password: body.password,
                                recaptcha_data: captcha,
                            });
                            localStorage.setItem(storageKey, r.data.auth_data);
                            if (boot.mode === "admin") {
                                try {
                                    await request(admin("config/fetch"));
                                } catch (e) {
                                    localStorage.removeItem(storageKey);
                                    throw e;
                                }
                            }
                            const info = await request("user/info");
                            onLogin(info.data);
                            navigate(
                                boot.mode === "admin"
                                    ? "overview"
                                    : "dashboard",
                            );
                        }}
                    >
                        <Captcha onChange={setCaptcha} />
                        {(forget || (register && boot.emailVerify)) && (
                            <>
                                <button
                                    type="button"
                                    disabled={sending || cooldown > 0}
                                    onClick={async () => {
                                        setMailError("");
                                        setSending(true);
                                        try {
                                            const email =
                                                formRef.current?.querySelector<HTMLInputElement>(
                                                    "input",
                                                )?.value;
                                            if (!email)
                                                throw new Error(
                                                    tx("请填写邮箱"),
                                                );
                                            await request(
                                                "passport/comm/sendEmailVerify",
                                                {
                                                    email,
                                                    isforget: forget ? 1 : 0,
                                                    recaptcha_data: captcha,
                                                },
                                            );
                                            setCooldown(60);
                                        } catch (e) {
                                            setMailError((e as Error).message);
                                        } finally {
                                            setSending(false);
                                        }
                                    }}
                                >
                                    {cooldown
                                        ? tx("{{value0}} 秒后重试", {
                                              value0: cooldown,
                                          })
                                        : sending
                                          ? tx("发送中…")
                                          : tx("发送邮箱验证码")}
                                </button>
                                {mailError && (
                                    <div className="alert">{mailError}</div>
                                )}
                            </>
                        )}
                    </Editor>
                    {boot.mode === "admin" && (
                        <div className="auth-links">
                            <a href={forget ? "#/login" : "#/forget"}>
                                {forget ? tx("登录") : tx("忘记密码？")}
                            </a>
                        </div>
                    )}
                    {boot.mode === "user" && (
                        <div className="auth-links">
                            <a href="#/login">{tx("登录")}</a>
                            {!boot.registerClosed && (
                                <a href="#/register">{tx("创建账户")}</a>
                            )}
                            <a href="#/forget">{tx("忘记密码？")}</a>
                        </div>
                    )}
                    {register && boot.tosUrl && (
                        <p className="muted">
                            {tx("注册即表示同意")}{" "}
                            <a
                                href={boot.tosUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {tx("服务条款")}
                            </a>
                            。
                        </p>
                    )}
                </div>
            </section>
        </div>
    );
}
function Captcha({ onChange }: { onChange: (value: string) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!boot.recaptchaSiteKey) return;
        let live = true;
        let id: number | undefined;
        const render = () => {
            if (live && ref.current && window.grecaptcha) {
                id = window.grecaptcha.render(ref.current, {
                    sitekey: boot.recaptchaSiteKey,
                    callback: onChange,
                    "expired-callback": () => onChange(""),
                });
            }
        };
        let script =
            document.querySelector<HTMLScriptElement>("#recaptcha-loader");
        if (window.grecaptcha) render();
        else {
            if (!script) {
                script = document.createElement("script");
                script.id = "recaptcha-loader";
                script.src =
                    "https://www.google.com/recaptcha/api.js?render=explicit";
                document.head.appendChild(script);
            }
            script.addEventListener("load", render);
        }
        return () => {
            live = false;
            if (script) script.removeEventListener("load", render);
            if (id !== undefined) window.grecaptcha?.reset(id);
        };
    }, []);
    return boot.recaptchaSiteKey ? <div ref={ref} /> : null;
}
function App() {
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
        if (boot.mode === "admin" && path === "generate") navigate("users");
    }, [path]);
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
            setPath(location.hash.slice(2).split("?")[0] || "");
            setOpen(false);
        };
        const expire = () => {
            setUser(null);
            setPath("login");
            navigate("login");
        };
        window.addEventListener("hashchange", fn);
        window.addEventListener("auth-expired", expire);
        if (boot.mode === "user" && currentDevice().embedded) {
            setLoading(false);
            return;
        }
        if (boot.landing && location.hash.startsWith("#/"))
            location.replace("/app" + location.hash);
        if (!boot.landing && localStorage.getItem(storageKey))
            readRequest("user/info")
                .then(async (r) => {
                    if (boot.mode === "admin")
                        await request(admin("config/fetch"));
                    if (boot.mode === "user")
                        await applyAccountLanguage(r.data.language);
                    setUser(r.data);
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
                {boot.mode === "user" ? (
                    <UserAuth
                        key={path}
                        mode={
                            ["register", "forget"].includes(path)
                                ? path
                                : "login"
                        }
                        onLogin={setUser}
                        renderCaptcha={(handler) => (
                            <Captcha onChange={handler} />
                        )}
                    />
                ) : (
                    <Auth mode={path} onLogin={setUser} />
                )}
            </>
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
    const nav = boot.mode === "admin" ? adminNav : userNav,
        current =
            boot.mode === "admin"
                ? adminPage(path)
                : path.split("/")[0] || nav[0]?.key || "dashboard",
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
    let content: ReactNode;
    if (boot.mode === "admin") {
        content = (
            <React.Suspense
                fallback={
                    <div className="state">
                        <span className="spinner" />
                        {tx("正在加载…")}
                    </div>
                }
            >
                <AdminContent current={current} />
            </React.Suspense>
        );
    } else {
        content = (
            <React.Suspense fallback={<WorkspaceSkeleton />}>
                <UserContent current={current} path={path} />
            </React.Suspense>
        );
    }
    if (["admin"].includes(boot.mode))
        return (
            <AdminShell current={current} user={user} logout={handleLogout}>
                {content}
            </AdminShell>
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
                    <a
                        className="brand"
                        href={
                            boot.mode === "admin" ? `/${boot.adminPath}` : "/"
                        }
                    >
                        <span className="brand-mark">
                            <Sparkles size={19} aria-hidden="true" />
                        </span>
                        <span>
                            {boot.title}
                            <small>
                                {boot.mode === "admin"
                                    ? tx("管理控制台")
                                    : tx("用户工作空间")}
                            </small>
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
                            <small>
                                {boot.mode === "admin"
                                    ? tx("管理员")
                                    : tx("个人账户")}
                            </small>
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
                            <span>
                                {boot.mode === "admin"
                                    ? tx("管理后台")
                                    : tx("工作空间")}
                            </span>
                            <ChevronRight size={14} />
                            <strong>{tx(item?.label || "总览")}</strong>
                        </div>
                        <div className="actions header-controls">
                            {boot.mode === "user" && <LanguagePicker />}
                            {boot.mode === "admin" && (
                                <a
                                    className="button"
                                    href="/"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    {tx("用户端")}
                                    <ArrowUpRight size={15} />
                                </a>
                            )}
                            {boot.mode === "user" && <AnnouncementCenter />}
                            <AccountMenu user={user} logout={handleLogout} />
                        </div>
                    </header>
                    <main>
                        <div className="page-heading">
                            <div>
                                <span className="eyebrow">
                                    {boot.mode === "admin"
                                        ? "CONTROL CENTER"
                                        : "WORKSPACE"}
                                </span>
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
class ErrorBoundary extends React.Component<
    { children: ReactNode },
    { error: string }
> {
    state = { error: "" };
    static getDerivedStateFromError(e: Error) {
        return { error: e.message };
    }
    render() {
        return this.state.error ? (
            <Panel title={tx("页面暂时无法加载")}>
                <div className="pad">
                    <p>{this.state.error}</p>
                    <button onClick={() => location.reload()}>
                        {tx("重新加载")}
                    </button>
                </div>
            </Panel>
        ) : (
            this.props.children
        );
    }
}
createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
        <App />
    </ErrorBoundary>,
);
