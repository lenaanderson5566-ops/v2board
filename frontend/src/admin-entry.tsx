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
import { Tickets } from "./user";
import { UsersPage } from "./admin-users";
export default function AdminContent({ current }: { current: string }) {
    if (current === "users") return <UsersPage />;
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
            return <Tickets isAdmin />;
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
