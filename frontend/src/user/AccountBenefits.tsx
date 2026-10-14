import { Gift, TicketPercent, ArrowUpRight } from "lucide-react";
import { useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import type { V10WalletCoupon } from "../shared/v10-types";
import { useCouponActivities } from "./useCouponActivities";
export function AccountBenefits() {
    const activities=useCouponActivities();
    const wallet=useData<V10WalletCoupon[]>("user/coupon/wallet");
    const available=Array.isArray(wallet.data) ? wallet.data.filter(c=>c.status==="available").length : null;
    const offer=Array.isArray(activities.data) ? activities.data[0] : null;
    return <section className="account-benefits" aria-label={tx("我的优惠券")}>
        <a className="account-benefit-wallet" href="#/coupons"><TicketPercent size={22} aria-hidden="true"/><span><strong>{tx("我的优惠券")}</strong><small>{available === null ? "—" : `${available} ${tx("可使用")}`}</small></span><ArrowUpRight size={18} aria-hidden="true"/></a>
        {offer && <a className="account-benefit-activity" href="#/activities"><Gift size={22} aria-hidden="true"/><span><strong>{offer.activityTitle || offer.name}</strong>{offer.activityDescription && <small>{offer.activityDescription}</small>}<small>{tx("查看活动")}</small></span><ArrowUpRight size={18} aria-hidden="true"/></a>}
    </section>;
}
