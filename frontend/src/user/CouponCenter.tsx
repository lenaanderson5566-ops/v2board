import { useCouponActivities } from "./useCouponActivities";
import { useRef, useState } from "react";
import { Gift, TicketPercent, CheckCircle2, ArrowUpRight } from "lucide-react";
import { request } from "../shared/api";
import { State, useData } from "../shared/ui";
import { tx } from "../shared/i18n";
import { formatInstant } from "../shared/timezone";
import type { V10WalletCoupon } from "../shared/v10-types";
import { pricingCopy as pc } from "./pricing-copy";
import { couponRestrictions, couponStatus } from "./coupon-copy";
import { JourneyIllustration } from "./JourneyIllustration";
import { availableCouponIntent, catalogReturnPath } from "./checkout-navigation";

export function ActivityCenter() {
    const offers = useCouponActivities();
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
        <section className="coupon-center activity-center">
            <div className="coupon-center-intro activity-hero">
                <div className="activity-hero-art" aria-hidden="true">
                    <Gift size={60} />
                    <TicketPercent size={32} />
                </div>
                <div className="activity-hero-copy">
                    <h2>{pc("activityHero")}</h2>
                    <p>
                        {tx("先了解活动并领取优惠券，购买套餐时再选择使用。")}
                    </p>
                </div>
                <a href="#/coupons">
                    {tx("我的优惠券")}
                    <ArrowUpRight size={16} aria-hidden="true" />
                </a>
            </div>
            <p className="activity-steps">
                <CheckCircle2 size={17} aria-hidden="true" />
                {pc("activitySteps")}
            </p>
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
                            className={`coupon-activity-card activity-offer ${claimed.includes(offer.id) ? "claimed" : ""}`}
                            key={offer.id}
                        >
                            <span className="coupon-discount">
                                <small>{tx("减免")}</small>
                                <strong>
                                    {offer.discountPercent}
                                    <span>%</span>
                                </strong>
                            </span>
                            <h3>{offer.activityTitle || offer.name}</h3>
                            {offer.activityDescription && (
                                <p className="coupon-activity-description">
                                    {offer.activityDescription}
                                </p>
                            )}
                            <div className="coupon-activity-terms">
                                {offer.activityTitle &&
                                    offer.activityTitle !== offer.name && (
                                        <strong>
                                            <TicketPercent
                                                size={16}
                                                aria-hidden="true"
                                            />
                                            {offer.name}
                                        </strong>
                                    )}
                                <p>{couponRestrictions(offer)}</p>
                                <small>
                                    {tx("有效期至")}{" "}
                                    {formatInstant(offer.expiresAt)}
                                </small>
                                <small>{pc("claimLimit")}</small>
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
                        <JourneyIllustration kind="coupon" />
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
    const [view, setView] = useState("available");
    const activities = useCouponActivities();
    const wallet = useData<V10WalletCoupon[]>("user/coupon/wallet");
    const rows = Array.isArray(wallet.data) ? wallet.data : [];
    const inView = (c: V10WalletCoupon, category: string) =>
        category === "available"
            ? c.status === "available"
            : category === "used"
              ? c.status !== "available" && c.status !== "expired"
              : c.status === "expired";
    const visible = rows
        .filter((c) => inView(c, view))
        .sort(
            (a, b) =>
                Date.parse(a.expiresAt) - Date.parse(b.expiresAt) ||
                b.discountPercent - a.discountPercent,
        );
    return (
        <section className="coupon-center coupon-wallet-page">
            <div className="coupon-center-intro wallet-hero">
                <JourneyIllustration kind="coupon" />
                <div>
                    <p>
                        {tx(
                            "领取和管理员发放的优惠券都在这里，结算时选择使用。",
                        )}
                    </p>
                </div>
                {activities.hasActivities && (
                    <a href="#/activities">
                        {tx("查看活动")}
                        <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                )}
            </div>
            <div
                className="coupon-wallet-tabs"
                role="group"
                aria-label={tx("我的优惠券")}
            >
                {[
                    ["available", "可使用"],
                    ["used", "已占用或使用"],
                    ["expired", "已过期"],
                ].map(([key, label]) => (
                    <button
                        key={key}
                        aria-pressed={view === key}
                        onClick={() => setView(key)}
                    >
                        {tx(label)}{" "}
                        <span className="coupon-count">
                            {wallet.data
                                ? rows.filter((c) => inView(c, key)).length
                                : "—"}
                        </span>
                    </button>
                ))}
            </div>
            <State {...wallet} retry={wallet.reload}>
                <div className="coupon-center-grid">
                    {visible.map((coupon) => (
                        <article
                            key={coupon.id}
                            className={`coupon-activity-card wallet-coupon ${coupon.status === "available" ? "available" : "inactive"}`}
                        >
                            <span className="coupon-discount">
                                <small>{tx("减免")}</small>
                                <strong>
                                    {coupon.discountPercent}
                                    <span>%</span>
                                </strong>
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
                            {availableCouponIntent(coupon) && (
                                <a className="button soft-button" href={`#/${catalogReturnPath(undefined, undefined, coupon.id)}`}>
                                    {tx("选择套餐使用")}
                                </a>
                            )}
                        </article>
                    ))}
                </div>
                {!visible.length && (
                    <div className="coupon-center-empty">
                        <JourneyIllustration kind="coupon" />
                        <h3>
                            {tx(
                                rows.length
                                    ? "当前分类暂无优惠券"
                                    : "暂无优惠券",
                            )}
                        </h3>
                        {activities.hasActivities ? (
                            <a href="#/activities">{tx("前往活动中心")}</a>
                        ) : (
                            <a href="#/plan">{tx("购买订阅")}</a>
                        )}
                    </div>
                )}
            </State>
        </section>
    );
}
