import { ticketOrderReference } from "./user-navigation";
import { useAnalyticsPage } from "./product-analytics";
import { lazy, Suspense } from "react";
import { WorkspaceSkeleton } from "../shared/WorkspaceSkeleton";
const loadCoupons = () => import("./CouponCenter");
const ActivityCenter = lazy(() => loadCoupons().then(module => ({ default: module.ActivityCenter })));
const MyCoupons = lazy(() => loadCoupons().then(module => ({ default: module.MyCoupons })));
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
const AccountSecurity = lazy(() => import("./AccountSecurity").then(module => ({ default: module.AccountSecurity })));
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
        <Plans planId={/^plan\/[1-9]\d*$/.test(path) ? Number(path.split("/")[1]) : undefined} />
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
            <Suspense fallback={<WorkspaceSkeleton />}><UserBody {...props} /></Suspense>
        </>
    );
}
