import { Gift, ArrowUpRight } from "lucide-react";
import { tx } from "../shared/i18n";
import { useCouponActivities } from "./useCouponActivities";
export function AccountBenefits() {
    const activities=useCouponActivities();
    const offer=Array.isArray(activities.data) ? activities.data[0] : null;
    if (!offer) return null;
    return <section className="account-benefits" aria-label={tx("活动中心")}>
        {offer && <a className="account-benefit-activity" href="#/activities"><Gift size={22} aria-hidden="true"/><span><strong>{offer.activityTitle || offer.name}</strong>{offer.activityDescription && <small>{offer.activityDescription}</small>}<small>{tx("查看活动")}</small></span><ArrowUpRight size={18} aria-hidden="true"/></a>}
    </section>;
}
