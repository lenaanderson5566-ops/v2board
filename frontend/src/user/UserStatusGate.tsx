import { useEffect, type ReactNode } from "react";
import { useData, State } from "../shared/ui/data";
import { AccountEntry } from "./AccountEntry";

export function UserStatusGate({
    children,
    logout,
    support,
    onStatus,
    fallbackFooter,
}: {
    children: ReactNode;
    logout: () => void;
    support: ReactNode;
    fallbackFooter?: ReactNode;
    onStatus?: (user: import("../shared/api").Row) => void;
}) {
    const info = useData("user/info");
    useEffect(() => {
        if (info.data) onStatus?.(info.data);
    }, [info.data, onStatus]);
    useEffect(() => {
        const poll = setInterval(() => {
            if (document.visibilityState === "visible") info.reload();
        }, 60000);
        return () => clearInterval(poll);
    }, []);
    useEffect(() => {
        const status = info.data?.account_status;
        if (status?.state !== "active" || info.data?.expired_at === null)
            return;
        const wait =
            (Number(info.data?.expired_at) - Number(status.server_time)) * 1000;
        if (wait <= 0) return;
        const timer = setTimeout(
            () => window.dispatchEvent(new Event("data-changed")),
            Math.min(wait + 250, 2147483647),
        );
        return () => clearTimeout(timer);
    }, [info.data]);
    if (!info.data)
        return (
            <div className="access-page">
                <State {...info} retry={info.reload}>
                    <></>
                </State>
                {fallbackFooter}
            </div>
        );
    if (info.data?.account_status?.state === "banned")
        return (
            <div className="access-page">
                <div className="suspended-page">
                    <AccountEntry
                        state="banned"
                        onBack={logout}
                        support={support}
                    />
                </div>
                {fallbackFooter}
            </div>
        );
    return children;
}
