import { lazy, Suspense } from "react";
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
import { AdminSubscriptions } from "./AdminSubscriptions";
import { AdminInvitations } from "./AdminInvitations";
const AdminSystemLogs = lazy(() =>
    import("./AdminSystemLogs").then((module) => ({
        default: module.AdminSystemLogs,
    })),
);
import { RiskRules } from "./AdminRisk";
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
import { ResourcePage, resources, Settings, Payments, Nodes } from "./admin";
import { OrdersPage } from "./admin-orders";
import { AdminTickets, ContentPage } from "./admin-content";
import { UsersPage } from "./admin-users";
import { Overview } from "./admin-dashboard";
function AdminPageContent({ current }: { current: string }) {
    if (current === "security") return <MfaSecurity />;
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
            return <Settings />;
        case "tickets":
            return <AdminTickets />;
        case "payments":
            return <Payments />;
        case "nodes":
            return <Nodes key="nodes" />;
        default:
            return <Overview />;
    }
}

export default function AdminContent({ current }: { current: string }) {
    return (
        <Suspense
            fallback={
                <div className="panel pad" role="status">
                    正在加载页面…
                </div>
            }
        >
            <AdminPageContent current={current} />
        </Suspense>
    );
}
