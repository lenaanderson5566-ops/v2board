import { useCouponActivities } from "./useCouponActivities";
import { useEffect, useId } from "react";
import { formatInstant } from "../shared/timezone";
import { TicketPercent, ArrowUpRight } from "lucide-react";
import { State, useData } from "../shared/ui";
import { money } from "../shared/api";
import { pricingCopy as pc } from "./pricing-copy";
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
    amount = 0,
    currency = "CNY",
}: {
    planId: number;
    period: string;
    value: number | null;
    onChange: (id: number | null, coupon?: WalletCoupon) => void;
    amount?: number;
    currency?: string;
}) {
    const activities = useCouponActivities();
    const wallet = useData<WalletCoupon[]>("user/coupon/wallet");
    const rows = Array.isArray(wallet.data) ? wallet.data : [];
    const name = useId();
    const applicable = (coupon: WalletCoupon) =>
        (!coupon.planIds.length || coupon.planIds.includes(planId)) &&
        (!coupon.billingPeriods.length ||
            coupon.billingPeriods.includes(periods[period]));
    const usable = (coupon: WalletCoupon) =>
        coupon.status === "available" && applicable(coupon);
    const available = rows
        .filter(usable)
        .sort(
            (a, b) =>
                b.discountPercent - a.discountPercent ||
                Date.parse(a.expiresAt) - Date.parse(b.expiresAt),
        );
    const unavailable = rows.filter((coupon) => !usable(coupon));
    useEffect(() => {
        if (
            value !== null &&
            !wallet.loading &&
            !wallet.error &&
            wallet.data &&
            !rows.some((coupon) => coupon.id === value && usable(coupon))
        )
            onChange(null);
    }, [
        value,
        wallet.data,
        wallet.loading,
        wallet.error,
        planId,
        period,
        onChange,
    ]);
    const selected = rows.find(
        (coupon) => coupon.id === value && usable(coupon),
    );
    const unavailableReason = (coupon: WalletCoupon) =>
        tx(
            coupon.status === "available"
                ? "不适用当前套餐或周期"
                : coupon.status === "expired"
                  ? "已过期"
                  : "已占用或使用",
        );
    return (
        <section className="coupon-wallet coupon-picker-compact">
            <label htmlFor={name} className="coupon-picker-label">
                <TicketPercent size={18} aria-hidden="true" />
                {tx("我的优惠券")}
            </label>
            <State {...wallet} retry={wallet.reload}>
                {rows.length > 0 ? (
                    <>
                        <select
                            id={name}
                            value={selected?.id ?? ""}
                            onChange={(event) => {
                                const next = available.find(
                                    (coupon) =>
                                        String(coupon.id) ===
                                        event.target.value,
                                );
                                onChange(next?.id ?? null, next);
                            }}
                        >
                            <option value="">{tx("不使用优惠券")}</option>
                            {available.map((coupon) => (
                                <option key={coupon.id} value={coupon.id}>
                                    {coupon.name} · {tx("减免")}{" "}
                                    {coupon.discountPercent}%
                                    {amount > 0
                                        ? ` · ${pc("couponSaving", { amount: money(Math.floor((amount * coupon.discountPercent) / 100), currency) })}`
                                        : ""}
                                </option>
                            ))}
                            {unavailable.length > 0 && (
                                <optgroup label={pc("unavailableCoupons")}>
                                    {unavailable.map((coupon) => (
                                        <option
                                            key={coupon.id}
                                            disabled
                                            value={coupon.id}
                                        >
                                            {coupon.name} ·{" "}
                                            {unavailableReason(coupon)}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                        {selected && (
                            <small className="coupon-selected-detail">
                                {tx("有效期至")}{" "}
                                {formatInstant(selected.expiresAt)}
                            </small>
                        )}
                    </>
                ) : (
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
