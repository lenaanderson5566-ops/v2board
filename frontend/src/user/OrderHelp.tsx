import { useData } from "../shared/ui";
import { tx } from "../shared/i18n";

export function OrderHelp({ tradeNo }: { tradeNo: string }) {
    const account = useData("user/info");
    const allowed = !account.loading && !account.error && account.data?.ticket_creation === "allowed";
    return <a className="checkout-help" href={allowed
        ? `#/ticket/order/${encodeURIComponent(tradeNo)}`
        : "#/knowledge"}>
        {tx(allowed ? "此订单需要帮助？" : "帮助中心")}
    </a>;
}
