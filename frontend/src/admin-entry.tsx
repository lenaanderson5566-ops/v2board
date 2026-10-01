import {
    Overview,
    ResourcePage,
    resources,
    Settings,
    RiskSettings,
    Translations,
    GenerateUsers,
    Payments,
    Nodes,
    System,
} from "./admin";
import { OrdersPage } from "./admin-orders";
import { AdminTickets, ContentPage } from "./admin-content";
import { UsersPage } from "./admin-users";
export default function AdminContent({ current }: { current: string }) {
    if (current === "users") return <UsersPage />;
    if (current === "orders") return <OrdersPage />;
    if (current === "knowledge" || current === "notices")
        return <ContentPage kind={current} />;
    if (resources[current])
        return <ResourcePage key={current} resource={resources[current]} />;
    switch (current) {
        case "settings":
            return <Settings />;
        case "risk-settings":
            return <RiskSettings />;
        case "translations":
            return <Translations />;
        case "tickets":
            return <AdminTickets />;
        case "generate":
            return <GenerateUsers />;
        case "payments":
            return <Payments />;
        case "nodes":
            return <Nodes />;
        case "system":
            return <System />;
        default:
            return <Overview />;
    }
}
