import { AdminLogSettings } from "./AdminLogSettings";
import { AdminSubscriptions } from "./AdminSubscriptions";
import { AdminInvitations } from "./AdminInvitations";
import { AdminSystemLogs } from "./AdminSystemLogs";
import { RiskRules } from "./AdminRisk";
import { AdminClientReleases } from "./AdminClientReleases";
import { AdminBanners } from "./AdminBanners";
import { ResourcePage, resources, Settings, Payments, Nodes } from "./admin";
import { OrdersPage } from "./admin-orders";
import { AdminTickets, ContentPage } from "./admin-content";
import { UsersPage } from "./admin-users";
import { Overview } from "./admin-dashboard";
export default function AdminContent({ current }: { current: string }) {
    if (current === "plans" || current === "translations")
        return <AdminSubscriptions key={current} initialTab={current} />;
    if (current === "log-settings" || current === "risk-settings")
        return <AdminLogSettings />;
    if (current === "system")
        return <Overview key="system" initialTab="system" />;
    if (current === "system-log") return <AdminSystemLogs />;
    if (current === "ddns") return <Nodes key="ddns" initialTab="ddns" />;
    if (current === "invitations") return <AdminInvitations />;
    if (current === "users" || current === "usage") return <UsersPage />;
    if (current === "orders") return <OrdersPage />;
    if (current === "knowledge" || current === "notices")
        return <ContentPage kind={current} />;
    if (current === "risk") return <RiskRules />;
    if (current === "client-releases") return <AdminClientReleases />;
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
