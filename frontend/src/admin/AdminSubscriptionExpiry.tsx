import { instantDate } from "../shared/timezone";
import { StatusBadge, type StatusTone } from "../shared/StatusBadge";
import { adminInstant } from "./admin-log-time";

export function AdminSubscriptionExpiry({ user }: {
    user: { expired_at?: unknown; transfer_enable?: unknown; credit_balance?: unknown };
}) {
    const expiry = instantDate(user.expired_at);
    const expiryAt = expiry?.getTime();
    const noFixedExpiry = user.expired_at === null && Number(user.transfer_enable) > 0;
    const hasCurrentTerm = noFixedExpiry || (expiryAt !== undefined && expiryAt > Date.now());
    let label = "到期信息缺失";
    let tone: StatusTone | undefined;
    if (noFixedExpiry) label = "无固定到期";
    else if (user.expired_at === null) label = "未设置到期（空值）";
    else if (expiryAt === 0) label = "未设置到期（默认值）";
    else if (expiry) {
        label = hasCurrentTerm ? "未到期" : "已到期";
        tone = hasCurrentTerm ? "success" : "danger";
    }

    return <span className="admin-subscription-expiry">
        {tone ? <StatusBadge tone={tone}>{label}</StatusBadge> : <span>{label}</span>}
        {expiry && expiryAt !== 0 && <time dateTime={expiry.toISOString()}>{adminInstant(expiry)}</time>}
        {!hasCurrentTerm && Number(user.credit_balance) > 0 && <small className="muted">另有可用流量额度包</small>}
    </span>;
}
