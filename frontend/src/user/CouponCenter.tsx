import { useRef, useState } from "react";
import { Gift, TicketPercent, CheckCircle2, ArrowUpRight } from "lucide-react";
import { request } from "../shared/api";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { formatInstant } from "../shared/timezone";
import type { V10WalletCoupon, V10CouponOffer } from "../shared/v10-types";
import { couponRestrictions, couponStatus } from "./coupon-copy";

export function ActivityCenter() {
    const offers = useData<V10CouponOffer[]>("user/coupon/offers");
    const rows = Array.isArray(offers.data) ? offers.data : [];
    const lock = useRef(false);
    const [busy, setBusy] = useState<number | null>(null),
        [claimed, setClaimed] = useState<number[]>([]),
        [error, setError] = useState(""),
        [message, setMessage] = useState("");
    async function claim(id: number) {
        if (lock.current || claimed.includes(id)) return;
        lock.current = true;
        setBusy(id);
        setError("");
        setMessage("");
        try {
            await request("user/coupon/claim", { coupon_id: id });
            setClaimed((previous) => [...previous, id]);
            setMessage(tx("领取成功，已放入我的优惠券"));
            offers.reload();
        } catch (error) {
            setError(
                error instanceof Error ? error.message : tx("领取失败，请重试"),
            );
        } finally {
            lock.current = false;
            setBusy(null);
        }
    }
    return (
        <section className="coupon-center">
            <div className="coupon-center-intro">
                <Gift size={24} aria-hidden="true" />
                <div>
                    <h2>{tx("活动中心")}</h2>
                    <p>
                        {tx("先了解活动并领取优惠券，购买套餐时再选择使用。")}
                    </p>
                </div>
                <a href="#/coupons">
                    {tx("我的优惠券")}
                    <ArrowUpRight size={16} aria-hidden="true" />
                </a>
            </div>
            {error && (
                <p className="alert" role="alert">
                    {error}
                </p>
            )}
            {message && (
                <p className="coupon-claim-success" role="status">
                    <CheckCircle2 size={18} aria-hidden="true" />
                    {message}
                    <a href="#/coupons">{tx("查看优惠券")}</a>
                </p>
            )}
            <State {...offers} retry={offers.reload}>
                <div className="coupon-center-grid">
                    {rows.map((offer) => (
                        <article
                            className="coupon-activity-card"
                            key={offer.id}
                        >
                            <span className="coupon-discount">
                                {tx("减免")} {offer.discountPercent}%
                            </span>
                            <h3>{offer.activityTitle || offer.name}</h3>
                            {offer.activityDescription && (
                                <p className="coupon-activity-description">
                                    {offer.activityDescription}
                                </p>
                            )}
                            <div className="coupon-activity-terms">
                                <strong>
                                    <TicketPercent
                                        size={16}
                                        aria-hidden="true"
                                    />
                                    {offer.name}
                                </strong>
                                <p>{couponRestrictions(offer)}</p>
                                <small>
                                    {tx("有效期至")}{" "}
                                    {formatInstant(offer.expiresAt)}
                                </small>
                                <small>
                                    {tx("每人限领一次，数量有限，领完即止。")}
                                </small>
                            </div>
                            <button
                                className="primary"
                                type="button"
                                disabled={
                                    busy !== null || claimed.includes(offer.id)
                                }
                                onClick={() => void claim(offer.id)}
                            >
                                {tx(
                                    claimed.includes(offer.id)
                                        ? "已领取"
                                        : busy === offer.id
                                          ? "正在领取…"
                                          : "领取优惠券",
                                )}
                            </button>
                        </article>
                    ))}
                </div>
                {!rows.length && (
                    <div className="coupon-center-empty">
                        <Gift size={34} aria-hidden="true" />
                        <h3>{tx("暂无可领取的活动")}</h3>
                        <p>{tx("可以查看已有优惠券，或稍后回来。")}</p>
                        <a href="#/coupons">{tx("我的优惠券")}</a>
                    </div>
                )}
            </State>
        </section>
    );
}

export function MyCoupons() {
    const wallet = useData<V10WalletCoupon[]>("user/coupon/wallet");
    const rows = Array.isArray(wallet.data) ? wallet.data : [];
    return (
        <section className="coupon-center">
            <div className="coupon-center-intro">
                <TicketPercent size={24} aria-hidden="true" />
                <div>
                    <h2>{tx("我的优惠券")}</h2>
                    <p>
                        {tx(
                            "领取和管理员发放的优惠券都在这里，结算时选择使用。",
                        )}
                    </p>
                </div>
                <a href="#/activities">
                    {tx("查看活动")}
                    <ArrowUpRight size={16} aria-hidden="true" />
                </a>
            </div>
            <State {...wallet} retry={wallet.reload}>
                <div className="coupon-center-grid">
                    {rows.map((coupon) => (
                        <article
                            key={coupon.id}
                            className={`coupon-activity-card ${coupon.status === "available" ? "" : "inactive"}`}
                        >
                            <span className="coupon-discount">
                                {tx("减免")} {coupon.discountPercent}%
                            </span>
                            <h3>{coupon.name}</h3>
                            <p>{couponRestrictions(coupon)}</p>
                            <small>
                                {tx("有效期至")}{" "}
                                {formatInstant(coupon.expiresAt)}
                            </small>
                            <span className="coupon-state">
                                {couponStatus(coupon)}
                            </span>
                            {coupon.status === "available" && (
                                <a className="button" href="#/plan">
                                    {tx("选择套餐使用")}
                                </a>
                            )}
                        </article>
                    ))}
                </div>
                {!rows.length && (
                    <div className="coupon-center-empty">
                        <TicketPercent size={34} aria-hidden="true" />
                        <h3>{tx("暂无优惠券")}</h3>
                        <a href="#/activities">{tx("前往活动中心")}</a>
                    </div>
                )}
            </State>
        </section>
    );
}
