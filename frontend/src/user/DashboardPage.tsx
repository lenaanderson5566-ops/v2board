import { lazy } from "react";
import { AccountBenefits } from "./AccountBenefits";
import { AccountEntry } from "./AccountEntry";
import { useData, State } from "../shared/ui";
import { type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { unfinishedOrder } from "./billing-flow";
import { orderResumePath } from "./checkout-navigation";
import { PendingOrderNotice } from "./PendingOrderNotice";

const UsagePage = lazy(() => import("./UsagePage").then(module => ({ default: module.UsagePage })));

function NewAccountEntry({ reloadAccount }: { reloadAccount: () => void }) {
    const orders = useData<Row[]>("user/order/fetch");
    const pending = unfinishedOrder(orders.data || []);
    function reload() {
        orders.reload();
        reloadAccount();
    }
    return (
        <State {...orders} retry={reload}>
            {pending ? (
                <section className="account-entry">
                    <h2>{tx("您有一笔待完成的订单")}</h2>
                    <p>
                        {tx(orderResumePath(pending).startsWith("plan/")
                            ? "继续完成订单即可开通服务，无需重新选择套餐。"
                            : "请先处理未完成的订单。")}
                    </p>
                    <PendingOrderNotice order={pending} reload={reload} />
                    <a className="button" href="#/knowledge">{tx("使用文档")}</a>
                </section>
            ) : orders.data && !orders.loading && !orders.error ? (
                <AccountEntry state="new" />
            ) : null}
        </State>
    );
}

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
                {user.account_status.state === "new" ? (
                    <NewAccountEntry reloadAccount={() => { info.reload(); sub.reload(); }} />
                ) : (
                    <AccountEntry
                        state={user.account_status.state}
                        subscription={s}
                    />
                )}
                {user.account_status.state !== "banned" && <AccountBenefits />}
            </State>
        );
    return <><UsagePage /><AccountBenefits /></>;
}

export function Traffic() {
    return <UsagePage />;
}
