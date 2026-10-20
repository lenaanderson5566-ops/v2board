import { PasskeySecurity } from "../shared/PasskeySecurity";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { lazy, Suspense } from "react";
const AdminDictionary = lazy(() => import("./AdminDictionary").then(m=>({default:m.AdminDictionary})));
const AdminAnalytics = lazy(() =>
    import("./AdminAnalytics").then((module) => ({
        default: module.AdminAnalytics,
    })),
);
const MfaSecurity = lazy(() =>
    import("../shared/MfaSecurity").then((module) => ({
        default: module.MfaSecurity,
    })),
);
const AdminMailBlocklist = lazy(() =>
    import("./AdminMailBlocklist").then((module) => ({
        default: module.AdminMailBlocklist,
    })),
);
const AdminCoupons = lazy(() =>
    import("./AdminCoupons").then((module) => ({
        default: module.AdminCoupons,
    })),
);
const AdminMailLogs = lazy(() =>
    import("./AdminMailLogs").then((module) => ({
        default: module.AdminMailLogs,
    })),
);
const AdminClientDiagnostics = lazy(() =>
    import("./AdminClientDiagnostics").then((module) => ({
        default: module.AdminClientDiagnostics,
    })),
);
const AdminLogSettings = lazy(() =>
    import("./AdminLogSettings").then((module) => ({
        default: module.AdminLogSettings,
    })),
);
const AdminSubscriptions = lazy(() =>
    import("./AdminSubscriptions").then((module) => ({
        default: module.AdminSubscriptions,
    })),
);
const AdminInvitations = lazy(() =>
    import("./AdminInvitations").then((module) => ({
        default: module.AdminInvitations,
    })),
);
const AdminSystemLogs = lazy(() =>
    import("./AdminSystemLogs").then((module) => ({
        default: module.AdminSystemLogs,
    })),
);
const RiskRules = lazy(() =>
    import("./AdminRisk").then((module) => ({ default: module.RiskRules })),
);
const AdminClients = lazy(() =>
    import("./AdminClients").then((module) => ({
        default: module.AdminClients,
    })),
);
const AdminBanners = lazy(() =>
    import("./AdminBanners").then((module) => ({
        default: module.AdminBanners,
    })),
);
import { ResourcePage, resources } from "./admin";
const Settings = lazy(() =>
    import("./admin-settings").then((module) => ({ default: module.Settings })),
);
const Payments = lazy(() =>
    import("./admin-payments").then((module) => ({ default: module.Payments })),
);
const Nodes = lazy(() =>
    import("./admin-nodes").then((module) => ({ default: module.Nodes })),
);
const OrdersPage = lazy(() =>
    import("./admin-orders").then((module) => ({ default: module.OrdersPage })),
);
const AdminTickets = lazy(() =>
    import("./admin-content").then((module) => ({
        default: module.AdminTickets,
    })),
);
const ContentPage = lazy(() =>
    import("./admin-content").then((module) => ({
        default: module.ContentPage,
    })),
);
const UsersPage = lazy(() =>
    import("./admin-users").then((module) => ({ default: module.UsersPage })),
);
const Overview = lazy(() =>
    import("./admin-dashboard").then((module) => ({
        default: module.Overview,
    })),
);
function AdminPageContent({ current }: { current: string }) {
    if (current === "dictionary") return <AdminDictionary />;
    if (current === "analytics") return <AdminAnalytics />;
    if (current === "security") return <><MfaSecurity /><PasskeySecurity /></>;
    if (current === "plans" || current === "translations")
        return <AdminSubscriptions key={current} initialTab={current} />;
    if (current === "log-settings" || current === "risk-settings")
        return <AdminLogSettings />;
    if (current === "system")
        return <Overview key="system" initialTab="system" />;
    if (current === "mail-blocklist")
        return (
            <section className="panel">
                <div className="panel-head">
                    <h2>邮件禁发名单</h2>
                </div>
                <AdminMailBlocklist />
            </section>
        );
    if (current === "mail-logs") return <AdminMailLogs />;
    if (current === "system-log") return <AdminSystemLogs />;
    if (current === "ddns") return <Nodes key="ddns" initialTab="ddns" />;
    if (current === "client-diagnostics") return <AdminClientDiagnostics />;
    if (current === "client-downloads")
        return <Settings key="client-downloads" section="app" />;
    if (current === "invitation-settings")
        return <Settings key="invitation-settings" section="invite" />;
    if (current === "invitations") return <AdminInvitations />;
    if (current === "users" || current === "usage") return <UsersPage />;
    if (current === "orders") return <OrdersPage />;
    if (current === "knowledge" || current === "notices")
        return <ContentPage kind={current} />;
    if (current === "risk") return <RiskRules />;
    if (current === "client-releases" || current === "clients")
        return (
            <AdminClients
                key={current}
                initialTab={current === "clients" ? "policy" : "updates"}
            />
        );
    if (current === "coupons") return <AdminCoupons />;
    if (resources[current])
        return <ResourcePage key={current} resource={resources[current]} />;
    switch (current) {
        case "banners":
            return <AdminBanners />;
        case "operations":
            return <Overview key="risk" initialTab="risk" />;
        case "settings":
            return <Settings key="settings" />;
        case "tickets":
            return <AdminTickets />;
        case "payments":
            return <Payments />;
        case "nodes":
            return <Nodes key="nodes" />;
        case "overview":
            return <Overview />;
        default:
            return (
                <section className="panel pad">
                    <h2>页面未找到</h2>
                    <p className="muted">
                        链接可能已变更，请从左侧导航选择功能。
                    </p>
                    <a href="#/overview">返回仪表盘</a>
                </section>
            );
    }
}

export default function AdminContent({ current }: { current: string }) {
    return (
        <ErrorBoundary
            key={current}
            message="此页面暂时无法加载。可以从左侧进入其他功能，或重新加载页面；未保存的输入可能丢失。"
        >
            <Suspense
                fallback={
                    <div className="panel pad" role="status">
                        正在加载页面…
                    </div>
                }
            >
                <AdminPageContent current={current} />
            </Suspense>
        </ErrorBoundary>
    );
}
