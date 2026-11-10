import { settingSections } from "./admin-navigation";
import { AdminRouteTabs } from "./AdminChoices";
import { PasskeySecurity } from "../shared/PasskeySecurity";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { lazy, Suspense } from "react";
const AdminDictionary = lazy(() =>
    import("./AdminDictionary").then((m) => ({ default: m.AdminDictionary })),
);
const AdminTargetStatistics = lazy(() =>
    import("./AdminTargetStatistics").then((m) => ({
        default: m.AdminTargetStatistics,
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
const AdminPlanTranslations = lazy(() => import("./AdminPlanTranslations"));
const AdminBillingCurrency = lazy(() =>
    import("./AdminBillingCurrency").then(module => ({ default: module.AdminBillingCurrency })),
);
const AdminResourceRoute = lazy(() => import("./AdminResourceRoute"));
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
const Settings = lazy(() =>
    import("./admin-settings").then((module) => ({ default: module.Settings })),
);
const Payments = lazy(() =>
    import("./admin-payments").then((module) => ({ default: module.Payments })),
);
const Nodes = lazy(() =>
    import("./admin-nodes").then((module) => ({ default: module.Nodes })),
);
const Infrastructure = lazy(() => import("./Infrastructure").then(m => ({default:m.Infrastructure})));
const AdminDDNS = lazy(() => import("./AdminDDNS").then(m => ({default:m.AdminDDNS})));
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
function AdminPageContent({ current, route }: { current: string; route: string }) {
    if (current === "invitations") return <AdminInvitations route={route} />;
    return (
        <AdminRouteTabs route={route}>
            <AdminPageBody key={current} current={current} route={route} />
        </AdminRouteTabs>
    );
}
function AdminPageBody({ current, route }: { current: string; route: string }) {
    if (Object.hasOwn(settingSections, current))
        return <Settings key={current} section={settingSections[current]} />;
    if (current === "dictionary") return <AdminDictionary />;
    if (current === "overview-analytics")
        return <Overview key="overview-analytics" initialTab="analytics" />;
    if (current === "log-targets") return <AdminTargetStatistics />;
    if (current === "security")
        return (
            <>
                <MfaSecurity />
                <PasskeySecurity />
            </>
        );
    if (current === "plans-translations") return <AdminPlanTranslations />;
    if (current === "plans-currencies") return <AdminBillingCurrency />;
    if (current === "log-settings")
        return <AdminLogSettings route={route} />;
    if (current === "overview-system")
        return <Overview key="overview-system" initialTab="system" />;
    if (current === "notification-blocklist")
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
    if (current === "node-domains") return <AdminDDNS />;
    if (["servers", "server-lightsail"].includes(current)) return <Infrastructure section={current} />;
    if (current === "node-forwarding") return <Nodes initialTab="forwarding" />;
    if (current === "client-diagnostics") return <AdminClientDiagnostics />;
    if (current === "client-downloads")
        return <Settings key="client-downloads" section="app" />;
    if (current === "users") return <UsersPage />;
    if (current === "orders") return <OrdersPage />;
    if (current === "knowledge" || current === "notices")
        return <ContentPage kind={current} />;
    if (current === "risk") return <RiskRules />;
    if (current === "client-releases" || current === "clients")
        return (
            <AdminClients
                key={current}
                view={current === "clients" ? "policy" : "updates"}
            />
        );
    if (current === "coupons") return <AdminCoupons />;
    switch (current) {
        case "banners":
            return <AdminBanners />;
        case "overview-risk":
            return <Overview key="risk" initialTab="risk" />;
        case "tickets":
            return <AdminTickets route={route} />;
        case "payments":
            return <Payments />;
        case "nodes":
            return <Nodes key="nodes" />;
        case "overview":
            return <Overview />;
        default:
            return <AdminResourceRoute path={current} />;
    }
}

export default function AdminContent({ route }: { route: string }) {
    const current = route.split("?", 1)[0];
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
                <AdminPageContent current={current} route={route} />
            </Suspense>
        </ErrorBoundary>
    );
}
