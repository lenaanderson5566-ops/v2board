import { useData } from "../shared/ui";
import type { V10CouponOffer } from "../shared/v10-types";

export function useCouponActivities(enabled = true) {
    const offers = useData<V10CouponOffer[]>(
        enabled ? "user/coupon/offers" : "",
    );
    return {
        ...offers,
        hasActivities: Array.isArray(offers.data) && offers.data.length > 0,
    };
}
