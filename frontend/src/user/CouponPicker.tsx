import { formatPercent } from "../shared/number-format";
import { useEffect, useId, useRef } from "react";
import { formatInstant } from "../shared/timezone";
import { TicketPercent, ChevronDown } from "lucide-react";
import { State, useData } from "../shared/ui";
import { money } from "../shared/api";
import { pricingCopy as pc } from "./pricing-copy";
import { usablePurchaseCoupon } from "./billing-flow";
import { tx } from "../shared/i18n";
import type { V10WalletCoupon } from "../shared/v10-types";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { availableCouponIntent, purchaseCouponId } from "./checkout-navigation";

import "./coupon-picker.css";

export type WalletCoupon = V10WalletCoupon;
export function CouponPicker({
    planId,
    period,
    value,
    onChange,
    amount = 0,
    currency = "CNY",
    couponIntentId,
    onManualChange,
}: {
    planId: number;
    period: string;
    value: number | null;
    onChange: (id: number | null, coupon?: WalletCoupon) => void;
    amount?: number;
    currency?: string;
    couponIntentId?: number;
    onManualChange?: () => void;
}) {
    const wallet = useData<WalletCoupon[]>("user/coupon/wallet");
    const retryIn = useRetryCountdown(wallet.retryAt);
    const rows = Array.isArray(wallet.data) ? wallet.data : [];
    const name = useId();
    const summaryId = `${name}-summary`;
    const disclosure = useRef<HTMLDetailsElement>(null);
    const handledIntents = useRef(new Set<number>());
    const manualChoice = useRef(false);
    const usable = (coupon: WalletCoupon) =>
        availableCouponIntent(coupon) && usablePurchaseCoupon(coupon, planId, period);
    const available = rows
        .filter(usable)
        .sort(
            (a, b) =>
                b.discountPercent - a.discountPercent ||
                Date.parse(a.expiresAt) - Date.parse(b.expiresAt),
        );
    const unavailable = rows.filter((coupon) => !usable(coupon));
    const bestSaving = available.length
        ? Math.floor((amount * available[0].discountPercent) / 100)
        : 0;
    useEffect(() => {
        const id = purchaseCouponId(couponIntentId);
        if (!id || handledIntents.current.has(id) || manualChoice.current ||
            wallet.loading || wallet.error || !Array.isArray(wallet.data)) return;
        const intended = rows.find((coupon) => coupon.id === id);
        // An unavailable or unowned hint is consumed without applying anything.
        // A valid but incompatible hint waits for an eligible cycle, never changes it.
        if (!intended || !availableCouponIntent(intended) || value !== null) {
            handledIntents.current.add(id);
            return;
        }
        if (usable(intended)) {
            handledIntents.current.add(id);
            onChange(intended.id, intended);
        }
    }, [couponIntentId, wallet.data, wallet.loading, wallet.error, planId, period, value, onChange]);
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
    function choose(coupon?: WalletCoupon) {
        manualChoice.current = true;
        onManualChange?.();
        onChange(coupon?.id ?? null, coupon);
        if (disclosure.current) {
            disclosure.current.open = false;
            disclosure.current.querySelector("summary")?.focus();
        }
    }
    function renderCoupon(coupon: WalletCoupon) {
        const enabled = usable(coupon);
        return (
            <label
                key={coupon.id}
                className={`checkout-coupon-option${value === coupon.id ? " is-selected" : ""}${enabled ? "" : " is-disabled"}`}
            >
                <input
                    type="radio"
                    name={name}
                    checked={value === coupon.id}
                    disabled={!enabled}
                    onChange={() => choose(coupon)}
                />
                <span>
                    <strong>{coupon.name}</strong>
                    <small>
                        {tx("有效期至")} {formatInstant(coupon.expiresAt, { second: undefined })}
                    </small>
                    {!enabled && <small>{unavailableReason(coupon)}</small>}
                </span>
                {enabled && (
                    <span className="checkout-coupon-saving">
                        {amount > 0
                            ? pc("couponSaving", {
                                  amount: money(
                                      Math.floor(
                                          (amount * coupon.discountPercent) /
                                              100,
                                      ),
                                      currency,
                                  ),
                              })
                            : `${tx("减免")} ${formatPercent(coupon.discountPercent, { maximumFractionDigits: 0 })}`}
                    </span>
                )}
            </label>
        );
    }
    // Keep error recovery visible, but do not advertise discounts without a usable coupon.
    if (!wallet.error && available.length === 0) return null;
    return (
        <section className="coupon-wallet coupon-picker-compact">
            {wallet.error && <div className="checkout-coupon-recovery" role="status">
                <span>{pc("couponUnavailable")}</span>
                <button type="button" disabled={wallet.loading || retryIn > 0} onClick={wallet.reload}>
                    {retryIn > 0 ? pc("retryIn", { seconds: retryIn }) : tx("重试")}
                </button>
            </div>}
            <State {...wallet} error="">
                {available.length > 0 && (
                    <details className="checkout-coupon" ref={disclosure}>
                        <summary
                            aria-label={tx("我的优惠券")}
                            aria-describedby={summaryId}
                        >
                            <TicketPercent size={16} aria-hidden="true" />
                            <span className="checkout-coupon-heading">
                                {tx("我的优惠券")}
                            </span>
                            <span
                                id={summaryId}
                                className="checkout-coupon-summary"
                            >
                                {selected ? (
                                    <>
                                        <span className="checkout-coupon-name">
                                            {selected.name}
                                        </span>
                                        {amount > 0 && (
                                            <span>
                                                {pc("couponSaving", {
                                                    amount: money(
                                                        Math.floor(
                                                            (amount *
                                                                selected.discountPercent) /
                                                                100,
                                                        ),
                                                        currency,
                                                    ),
                                                })}
                                            </span>
                                        )}
                                    </>
                                ) : bestSaving > 0 ? (
                                    pc("couponAvailableSaving", {
                                        amount: money(bestSaving, currency),
                                    })
                                ) : (
                                    pc("couponAvailable")
                                )}
                            </span>
                            <ChevronDown size={16} aria-hidden="true" />
                        </summary>
                        <div
                            className="checkout-coupon-options"
                            role="radiogroup"
                            aria-label={tx("我的优惠券")}
                        >
                            <label
                                className={`checkout-coupon-option${selected ? "" : " is-selected"}`}
                            >
                                <input
                                    type="radio"
                                    name={name}
                                    checked={!selected}
                                    onChange={() => choose()}
                                />
                                <span>{tx("不使用优惠券")}</span>
                            </label>
                            {available.map(renderCoupon)}
                            {unavailable.length > 0 && (
                                <details className="checkout-coupon-unavailable">
                                    <summary>
                                        {pc("unavailableCoupons")} (
                                        {unavailable.length})
                                    </summary>
                                    {unavailable.map(renderCoupon)}
                                </details>
                            )}
                        </div>
                    </details>
                )}
            </State>
        </section>
    );
}
