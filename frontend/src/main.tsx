import { tx, locale } from "./i18n";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
    LayoutDashboard,
    Globe,
    ShoppingBag,
    ReceiptText,
    BookOpen,
    MessageCircle,
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
    UserRound,
    Activity,
    MonitorSmartphone,
    Bell,
    Route,
    Layers,
    Server,
    X,
} from "lucide-react";
import { boot, request, storageKey, navigate, admin, type Row } from "./api";
import { Editor, Panel, type Field } from "./ui";
import {
    UserDashboard,
    Subscribe,
    Plans,
    Orders,
    Knowledge,
    Tickets,
    Invite,
    Profile,
    Traffic,
} from "./user";
const AdminContent = React.lazy(() => import("./admin-entry"));
import "./style.css";
import "./console.css";
import { useTranslation } from "react-i18next";
import { LanguagePicker } from "./LanguagePicker";
type Nav = { key: string; label: string; icon: typeof Globe; group: string };
const userNav: Nav[] = [
    {
        key: "dashboard",
        label: "总览",
        icon: LayoutDashboard,
        group: "工作空间",
    },
    { key: "subscribe", label: "我的订阅", icon: Globe, group: "工作空间" },
    { key: "plan", label: "购买订阅", icon: ShoppingBag, group: "工作空间" },
    { key: "order", label: "订单记录", icon: ReceiptText, group: "工作空间" },
    { key: "traffic", label: "流量记录", icon: Activity, group: "工作空间" },
    {
        key: "knowledge",
        label: "使用文档",
        icon: BookOpen,
        group: "帮助与账户",
    },
    {
        key: "ticket",
        label: "工单支持",
        icon: MessageCircle,
        group: "帮助与账户",
    },
    { key: "invite", label: "邀请好友", icon: Users, group: "帮助与账户" },
    { key: "profile", label: "账户设置", icon: Settings, group: "帮助与账户" },
];
const adminNav: Nav[] = [
    {
        key: "overview",
        label: "运营概览",
        icon: LayoutDashboard,
        group: "运营",
    },
    { key: "users", label: "用户管理", icon: Users, group: "运营" },
    { key: "generate", label: "生成用户", icon: UserRound, group: "运营" },
    { key: "orders", label: "订单管理", icon: ReceiptText, group: "运营" },
    { key: "plans", label: "套餐管理", icon: ShoppingBag, group: "服务" },
    { key: "nodes", label: "节点管理", icon: Server, group: "服务" },
    { key: "groups", label: "权限组", icon: Layers, group: "服务" },
    { key: "routes", label: "路由规则", icon: Route, group: "服务" },
    { key: "payments", label: "支付方式", icon: CreditCard, group: "服务" },
    { key: "coupons", label: "优惠券", icon: Ticket, group: "服务" },
    { key: "giftcards", label: "礼品卡", icon: Gift, group: "服务" },
    { key: "notices", label: "公告管理", icon: Bell, group: "内容与支持" },
    { key: "knowledge", label: "知识库", icon: BookOpen, group: "内容与支持" },
    {
        key: "tickets",
        label: "工单中心",
        icon: MessageCircle,
        group: "内容与支持",
    },
    {
        key: "translations",
        label: "套餐多语言",
        icon: Languages,
        group: "内容与支持",
    },
    { key: "risk", label: "风控规则", icon: Shield, group: "风控与客户端" },
    {
        key: "risk-settings",
        label: "风控设置",
        icon: Settings,
        group: "风控与客户端",
    },
    {
        key: "blacklist-ip",
        label: "IP 黑名单",
        icon: Network,
        group: "风控与客户端",
    },
    {
        key: "blacklist-ua",
        label: "UA 黑名单",
        icon: Shield,
        group: "风控与客户端",
    },
    {
        key: "clients",
        label: "客户端策略",
        icon: MonitorSmartphone,
        group: "风控与客户端",
    },
    { key: "online", label: "在线用户", icon: Activity, group: "风控与客户端" },
    { key: "usage", label: "用户使用情况", icon: Globe, group: "风控与客户端" },
    ...["login", "subscribe", "connection", "risk"].map((key, i) => ({
        key: "log-" + key,
        label: [tx("登录日志"), tx("订阅日志"), tx("连接日志"), tx("风控命中")][
            i
        ],
        icon: ScrollText,
        group: tx("日志与系统"),
    })),
    {
        key: "system-log",
        label: "系统日志",
        icon: ScrollText,
        group: "日志与系统",
    },
    { key: "system", label: "系统状态", icon: Activity, group: "日志与系统" },
    { key: "settings", label: "系统设置", icon: Settings, group: "日志与系统" },
];
function Auth({
    mode,
    onLogin,
}: {
    mode: string;
    onLogin: (user: Row) => void;
}) {
    const register = mode === "register" && boot.mode === "user",
        forget = mode === "forget" && boot.mode === "user";
    const [captcha, setCaptcha] = useState(""),
        [mailError, setMailError] = useState(""),
        [sending, setSending] = useState(false),
        [cooldown, setCooldown] = useState(0);
    const formRef = useRef<HTMLDivElement>(null);
    const fields: Field[] = [
        { key: "email", label: tx("邮箱地址"), required: true },
        {
            key: "password",
            label: forget ? tx("新密码") : tx("密码"),
            type: "password",
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
                    <span className="brand-mark">V</span>
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
                        fields={fields}
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
            navigate("login");
        };
        window.addEventListener("hashchange", fn);
        window.addEventListener("auth-expired", expire);
        if (localStorage.getItem(storageKey))
            request("user/info")
                .then(async (r) => {
                    if (boot.mode === "admin")
                        await request(admin("config/fetch"));
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
    if (loading)
        return (
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
                <Auth mode={path} onLogin={setUser} />
            </>
        );
    const nav = boot.mode === "admin" ? adminNav : userNav,
        current = path.split("/")[0] || nav[0].key,
        item = nav.find((n) => n.key === current),
        groups = [...new Set(nav.map((n) => n.group))];
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
        content =
            current === "subscribe" ? (
                <Subscribe />
            ) : current === "plan" ? (
                <Plans />
            ) : current === "order" ? (
                <Orders key={path} tradeNo={path.split("/")[1]} />
            ) : current === "knowledge" ? (
                <Knowledge />
            ) : current === "ticket" ? (
                <Tickets />
            ) : current === "invite" ? (
                <Invite />
            ) : current === "profile" ? (
                <Profile />
            ) : current === "traffic" ? (
                <Traffic />
            ) : (
                <UserDashboard />
            );
    }
    return (
        <div className={"app " + boot.mode}>
            {open && (
                <div className="nav-backdrop" onClick={() => setOpen(false)} />
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
                    href={boot.mode === "admin" ? `/${boot.adminPath}` : "/"}
                >
                    <span className="brand-mark">V</span>
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
                                            current === key ? "page" : undefined
                                        }
                                        className={
                                            current === key ? "active" : ""
                                        }
                                        href={"#/" + key}
                                        key={key}
                                    >
                                        <Icon size={18} />
                                        <span>{tx(label)}</span>
                                        {current === key && (
                                            <span className="nav-dot" />
                                        )}
                                    </a>
                                ))}
                        </div>
                    ))}
                </nav>
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
                        onClick={() => {
                            localStorage.removeItem(storageKey);
                            setUser(null);
                            navigate("login");
                        }}
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
                    <div className="actions">
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
                        <span className="online-indicator" />{" "}
                        <span className="muted">
                            {boot.mode === "admin"
                                ? tx("统一控制台")
                                : tx("服务在线")}
                        </span>
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
                        {boot.title} <span>{tx("简洁连接，无限可能。")}</span>
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
                                "subscribe",
                                "ticket",
                                "profile",
                            ].includes(n.key),
                        )
                        .map(({ key, label, icon: Icon }) => (
                            <a
                                key={key}
                                href={"#/" + key}
                                aria-current={
                                    current === key ? "page" : undefined
                                }
                                className={current === key ? "active" : ""}
                            >
                                <Icon size={21} />
                                <span>{tx(label)}</span>
                            </a>
                        ))}
                </nav>
            )}
        </div>
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
