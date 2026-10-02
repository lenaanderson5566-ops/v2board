import {
    UserDashboard,
    Plans,
    Orders,
    Knowledge,
    Tickets,
    Invite,
    Profile,
    Traffic,
} from "./user";
import { AccountSecurity } from "./AccountSecurity";
export default function UserContent({
    current,
    path,
}: {
    current: string;
    path: string;
}) {
    return current === "plan" ? (
        <Plans />
    ) : current === "order" ? (
        <Orders key={path} tradeNo={path.split("/")[1]} />
    ) : current === "knowledge" ? (
        <Knowledge />
    ) : current === "ticket" ? (
        <Tickets
            orderTradeNo={
                path.split("/")[1] === "order"
                    ? decodeURIComponent(path.split("/")[2] || "")
                    : undefined
            }
        />
    ) : current === "invite" ? (
        <Invite />
    ) : current === "security" ? (
        <AccountSecurity />
    ) : current === "profile" ? (
        <Profile />
    ) : current === "traffic" ? (
        <Traffic />
    ) : (
        <UserDashboard />
    );
}
