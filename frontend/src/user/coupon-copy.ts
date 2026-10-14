import { tx } from "../shared/i18n";
import type { V10WalletCoupon } from "../shared/v10-types";

const periods: Record<string, string> = {
    monthly: "月付",
    quarterly: "季付",
    semiannual: "半年付",
    annual: "年付",
    biennial: "两年付",
    triennial: "三年付",
    credits: "额度包",
    reset: "重置包",
};
export function couponRestrictions(
    coupon: Pick<V10WalletCoupon, "planIds" | "billingPeriods">,
): string {
    return [
        tx(coupon.planIds.length ? "仅限指定套餐" : "适用所有套餐"),
        coupon.billingPeriods.length
            ? coupon.billingPeriods
                  .map((period) => tx(periods[period] || period))
                  .join(" · ")
            : tx("适用所有周期"),
    ].join(" · ");
}
export function couponStatus(coupon: V10WalletCoupon): string {
    return tx(
        coupon.status === "available"
            ? "可使用"
            : coupon.status === "expired"
              ? "已过期"
              : "已占用或使用",
    );
}
