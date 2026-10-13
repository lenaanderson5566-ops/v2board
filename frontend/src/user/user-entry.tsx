import { FastaiDownload } from "./FastaiDownload";
import { BannerStrip } from "../shared/BannerStrip";
import {
    UserDashboard,
    Subscribe,
    Plans,
    Orders,
    Knowledge,
    Tickets,
    Invite,
    Profile,
    Notifications,
    Traffic,
} from "./user";
import { AccountSecurity } from "./AccountSecurity";
function UserBody({
    current,
    path,
}: {
    current: string;
    path: string;
}) {
    return current === "subscribe" ? (
        <Subscribe />
    ) : current === "plan" ? (
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
    ) : current === "notifications" ? (
        <Notifications />
    ) : current === "profile" ? (
        <Profile />
    ) : current === "traffic" ? (
        <Traffic />
    ) : (
        <>
            <BannerStrip placement="dashboard" />
            <UserDashboard />
        </>
    );
}

export default function UserContent(props: { current: string; path: string }) {
    return <>{["dashboard", "overview", "subscribe"].includes(props.current) && <FastaiDownload />}<UserBody {...props} /></>;
}
