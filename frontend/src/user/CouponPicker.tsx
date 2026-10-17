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
    const usable = (coupon: WalletCoupon) => coupon.status === "available" && applicable(coupon);
    const available = rows.filter(usable).sort((a, b) => b.discountPercent - a.discountPercent || Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
    const unavailable = rows.filter((coupon) => !usable(coupon));
    useEffect(() => {
        if (value !== null && !wallet.loading && !wallet.error && wallet.data && !rows.some((coupon) => coupon.id === value && usable(coupon))) onChange(null);
    }, [value, wallet.data, wallet.loading, wallet.error, planId, period, onChange]);
    const option = (coupon: WalletCoupon) => (
        <label key={coupon.id} className={`coupon-option ${value === coupon.id ? "selected" : ""} ${!usable(coupon) ? "unavailable" : ""}`}>
            <input type="radio" name={name} disabled={!usable(coupon)} checked={value === coupon.id} onChange={() => onChange(coupon.id, coupon)} />
            <span>
                <strong>{coupon.name} · {tx("减免")} {coupon.discountPercent}%</strong>
                <small>{formatInstant(coupon.expiresAt)} · {tx(usable(coupon) ? "可使用" : coupon.status === "available" ? "不适用当前套餐或周期" : coupon.status === "expired" ? "已过期" : "已占用或使用")}</small>
                {usable(coupon) && amount > 0 && <span className="coupon-saving">{pc("couponSaving", { amount: money(Math.floor(amount * coupon.discountPercent / 100), currency) })}</span>}
            </span>
        </label>
    );
    return (
        <section className="coupon-wallet">
            <h3><TicketPercent size={18} aria-hidden="true" />{tx("我的优惠券")}</h3>
            <label className={`coupon-option ${value === null ? "selected" : ""}`}>
                <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
                <span>{tx("不使用优惠券")}</span>
            </label>
            <State {...wallet} retry={wallet.reload}>
                <div className="coupon-options">{available.map(option)}</div>
                {unavailable.length > 0 && <details className="coupon-unavailable"><summary>{pc("unavailableCoupons")} ({unavailable.length})</summary>{unavailable.map(option)}</details>}
                {!rows.length && <p className="muted">{tx(activities.hasActivities ? "暂无优惠券，可前往活动中心查看" : "暂无优惠券")}</p>}
            </State>
            <div className="coupon-picker-links">
                {activities.hasActivities && <a href="#/activities">{tx("查看活动")}<ArrowUpRight size={14} aria-hidden="true" /></a>}
                <a href="#/coupons">{tx("管理优惠券")}</a>
            </div>
        </section>
    );
}
