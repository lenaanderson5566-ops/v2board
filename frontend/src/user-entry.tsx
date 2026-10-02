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
