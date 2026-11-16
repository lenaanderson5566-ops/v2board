import { instantDate } from "../shared/timezone";
import { finiteNumber } from "../shared/number-format";
import { StatusBadge, type StatusTone } from "../shared/StatusBadge";
import { adminInstant } from "./admin-log-time";

const expiryWarningMs = 7 * 86_400_000;

type PeriodicSubscription = {
    expired_at?: unknown;
    transfer_enable?: unknown;
    has_recurring_order_history?: boolean;
};

export function hasRecordedPeriodicPlan(user: PeriodicSubscription): boolean {
    const expiry = instantDate(user.expired_at);
    return expiry !== null && expiry.getTime() !== 0 && (finiteNumber(user.transfer_enable) ?? 0) > 0;
}

export function AdminSubscriptionExpiry({ user, precision = "second" }: {
    user: PeriodicSubscription;
    precision?: "minute" | "second";
}) {
    const expiry = instantDate(user.expired_at);
    const expiryAt = expiry?.getTime();
    const remainingMs = expiryAt === undefined ? 0 : expiryAt - Date.now();
    const quota = finiteNumber(user.transfer_enable);
    const hasSubscriptionQuota = quota !== null && quota > 0;
    const noFixedExpiry = user.expired_at === null && hasSubscriptionQuota;
    let label = "有效期内";
    let tone: StatusTone | undefined;
    if (noFixedExpiry) label = "旧版流量无固定到期";
    else if (user.expired_at === null || expiryAt === 0) {
        label = !hasSubscriptionQuota && user.has_recurring_order_history === false
            ? "尚未购买周期套餐"
            : "到期时间未记录";
    } else if (!expiry) label = "到期信息缺失";
    else if (remainingMs <= 0) {
        label = "已到期";
        tone = "danger";
    } else if (quota !== null && quota <= 0) {
        label = "周期权益未开通";
    } else if (remainingMs <= expiryWarningMs) {
        label = "即将到期";
        tone = "warning";
    }

    const normalTerm = label === "有效期内";
    return <span className={normalTerm ? "admin-subscription-expiry is-current" : "admin-subscription-expiry"}>
        {expiry && expiryAt !== 0 && (
            <time dateTime={expiry.toISOString()}>
                {adminInstant(expiry, { second: precision === "second" ? "2-digit" : undefined })}
            </time>
        )}
        {tone ? <StatusBadge tone={tone}>{label}</StatusBadge> : <span>{label}</span>}
    </span>;
}
