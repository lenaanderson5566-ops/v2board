import { ticketOrderReference } from "./user-navigation";
import { useAnalyticsPage } from "./product-analytics";
import { ActivityCenter, MyCoupons } from "./CouponCenter";
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
function UserBody({ current, path }: { current: string; path: string }) {
    const names = [
        "activities",
        "coupons",
        "subscribe",
        "plan",
        "order",
        "knowledge",
        "ticket",
        "invite",
        "security",
        "notifications",
        "profile",
        "traffic",
    ] as const;
    const page = names.find((name) => name === current) || "dashboard";
    useAnalyticsPage(
        page === "order" && path.split("/")[1] ? "order_detail" : page,
    );
    return current === "activities" ? (
        <ActivityCenter />
    ) : current === "coupons" ? (
        <MyCoupons />
    ) : current === "subscribe" ? (
        <Subscribe />
    ) : current === "plan" ? (
        <Plans />
    ) : current === "order" ? (
        <Orders key={path} tradeNo={path.split("/")[1]} />
    ) : current === "knowledge" ? (
        <Knowledge />
    ) : current === "ticket" ? (
        <Tickets
            orderTradeNo={ticketOrderReference(path)}
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
    return (
        <>
            {["dashboard", "overview", "subscribe"].includes(props.current) && (
                <FastaiDownload />
            )}
            <UserBody {...props} />
        </>
    );
}
