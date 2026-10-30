import { lazy } from "react";
import { NodeList } from "./NodeList";
import { AccountEntry } from "./AccountEntry";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import type { Row } from "../shared/api";
import { useData, State, Panel } from "../shared/ui";

const SubscriptionImport = lazy(() => import("./SubscriptionImport").then(module => ({ default: module.SubscriptionImport })));

export function Subscribe() {
    const info = useData("user/info");
    const ready = info.data?.account_status?.state === "active";
    const d = useData("user/getSubscribe"),
        nodes = useData<Row[]>(ready ? "user/server/fetch" : "");
    const s = d.data || {};
    if (!info.data)
        return (
            <State {...info} retry={info.reload}>
                <></>
            </State>
        );
    if (!ready)
        return (
            <AccountEntry
                state={info.data.account_status?.state || "new"}
                subscription={s}
            />
        );
    if (!d.data)
        return (
            <State {...d} retry={d.reload}>
                <></>
            </State>
        );
    return (
        <>
            <Panel
                title={tx("快速开始")}
                actions={
                    <a href="#/plan" className="button">
                        {tx("管理订阅")}
                    </a>
                }
            >
                <div aria-busy={d.loading}>
                    {d.loading && (
                        <p className="pad muted" role="status">
                            {e("refreshing")}
                        </p>
                    )}
                    {d.error && (
                        <div className="alert" role="alert">
                            {d.error}
                            <button onClick={d.reload}>{tx("重试")}</button>
                        </div>
                    )}
                    {s.subscribe_url &&
                    info.data.account_status?.is_available &&
                    !info.data.account_status?.quota_exhausted ? (
                        <SubscriptionImport url={s.subscribe_url} inline />
                    ) : (
                        <div className="pad">
                            <p>
                                {e(
                                    info.data.account_status?.quota_exhausted
                                        ? "exhausted"
                                        : "unavailable",
                                )}
                            </p>
                            <a className="button primary" href="#/plan">
                                {tx("管理订阅")}
                            </a>
                        </div>
                    )}
                </div>
            </Panel>
            <Panel title={tx("可用节点")}>
                <State {...nodes} retry={nodes.reload}>
                    <NodeList nodes={nodes.data || []} />
                </State>
            </Panel>
        </>
    );
}
