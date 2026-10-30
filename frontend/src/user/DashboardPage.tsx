import { lazy } from "react";
import { AccountBenefits } from "./AccountBenefits";
import { AccountEntry } from "./AccountEntry";
import { useData, State } from "../shared/ui";

const UsagePage = lazy(() => import("./UsagePage").then(module => ({ default: module.UsagePage })));

export function UserDashboard() {
    const info = useData("user/info"),
        sub = useData("user/getSubscribe");
    const user = info.data || {},
        s = sub.data || {};
    if (!info.data)
        return (
            <State {...info} retry={info.reload}>
                <></>
            </State>
        );
    if (user.account_status && user.account_status.state !== "active")
        return (
            <State {...info} retry={info.reload}>
                <AccountEntry
                    state={user.account_status.state}
                    subscription={s}
                />
                {user.account_status.state !== "banned" && <AccountBenefits />}
            </State>
        );
    return <><UsagePage /><AccountBenefits /></>;
}

export function Traffic() {
    return <UsagePage />;
}
