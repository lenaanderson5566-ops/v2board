import { useCouponActivities } from "./useCouponActivities";
import { useId } from "react";
import { formatInstant } from "../shared/timezone";
import { TicketPercent, ArrowUpRight } from "lucide-react";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import type { V10WalletCoupon } from "../shared/v10-types";

export type WalletCoupon = V10WalletCoupon;
const periods: Record<string, string> = {
    month_price: "monthly",
    quarter_price: "quarterly",
    half_year_price: "semiannual",
    year_price: "annual",
    two_year_price: "biennial",
    three_year_price: "triennial",
    onetime_price: "credits",
    reset_price: "reset",
};
export function CouponPicker({
    planId,
    period,
    value,
    onChange,
}: {
    planId: number;
    period: string;
    value: number | null;
    onChange: (id: number | null) => void;
}) {
    const activities = useCouponActivities();
    const wallet = useData<WalletCoupon[]>("user/coupon/wallet");
    const rows = Array.isArray(wallet.data) ? wallet.data : [];
    const name = useId();
    const applicable = (coupon: WalletCoupon) =>
        (!coupon.planIds.length || coupon.planIds.includes(planId)) &&
        (!coupon.billingPeriods.length ||
            coupon.billingPeriods.includes(periods[period]));
    return (
        <section className="coupon-wallet">
            <h3>
                <TicketPercent size={18} aria-hidden="true" />{" "}
                {tx("我的优惠券")}
            </h3>
            <label>
                <input
                    type="radio"
                    name={name}
                    checked={value === null}
                    onChange={() => onChange(null)}
                />
                {tx("不使用优惠券")}
            </label>
            <State {...wallet} retry={wallet.reload}>
                {rows.map((coupon) => {
                    const usable =
                        coupon.status === "available" && applicable(coupon);
                    return (
                        <label key={coupon.id} className="coupon-option">
                            <input
                                type="radio"
                                name={name}
                                disabled={!usable}
                                checked={value === coupon.id}
                                onChange={() => onChange(coupon.id)}
                            />
                            <span>
                                <strong>
                                    {coupon.name} · {tx("减免")}{" "}
                                    {coupon.discountPercent}%
                                </strong>
                                <small>
                                    {formatInstant(coupon.expiresAt)} ·{" "}
                                    {tx(
                                        usable
                                            ? "可使用"
                                            : coupon.status === "available"
                                              ? "不适用当前套餐或周期"
                                              : coupon.status === "expired"
                                                ? "已过期"
                                                : "已占用或使用",
                                    )}
                                </small>
                            </span>
                        </label>
                    );
                })}
                {!rows.length && (
                    <p className="muted">
                        {tx(
                            activities.hasActivities
                                ? "暂无优惠券，可前往活动中心查看"
                                : "暂无优惠券",
                        )}
                    </p>
                )}
            </State>
            <div className="coupon-picker-links">
                {activities.hasActivities && (
                    <a href="#/activities">
                        {tx("查看活动")}
                        <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                )}
                <a href="#/coupons">{tx("管理优惠券")}</a>
            </div>
        </section>
    );
}
