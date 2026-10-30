import { ticketOrderReference } from "./user-navigation";
import { useAnalyticsPage } from "./product-analytics";
import { lazy, Suspense } from "react";
import { WorkspaceSkeleton } from "../shared/WorkspaceSkeleton";
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

const loadCoupons = () => import("./CouponCenter");
const ActivityCenter = lazy(() => loadCoupons().then(module => ({ default: module.ActivityCenter })));
const MyCoupons = lazy(() => loadCoupons().then(module => ({ default: module.MyCoupons })));
const AccountSecurity = lazy(() => import("./AccountSecurity").then(module => ({ default: module.AccountSecurity })));

const pageViews = {
    activities: () => <ActivityCenter />,
    coupons: () => <MyCoupons />,
    subscribe: () => <Subscribe />,
    plan: (path: string) => (
        <Plans planId={/^plan\/[1-9]\d*$/.test(path) ? Number(path.split("/")[1]) : undefined} />
    ),
    order: (path: string) => <Orders key={path} tradeNo={path.split("/")[1]} />,
    knowledge: () => <Knowledge />,
    ticket: (path: string) => <Tickets orderTradeNo={ticketOrderReference(path)} />,
    invite: () => <Invite />,
    security: () => <AccountSecurity />,
    notifications: () => <Notifications />,
    profile: () => <Profile />,
    traffic: () => <Traffic />,
};
type UserPage = keyof typeof pageViews;

function UserBody({ current, path }: { current: string; path: string }) {
    const page = Object.prototype.hasOwnProperty.call(pageViews, current)
        ? (current as UserPage) : "dashboard";
    useAnalyticsPage(
        page === "order" && path.split("/")[1] ? "order_detail" : page,
    );
    return page !== "dashboard" ? pageViews[page](path) : (
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
