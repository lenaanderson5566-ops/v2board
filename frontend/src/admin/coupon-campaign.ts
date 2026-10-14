export type CouponCampaign = {
    id: number;
    previewKey: string;
    couponName: string;
    discountPercent: number;
    scope: "all" | "filtered" | "ids";
    status: string;
    matched: number;
    pending: number;
    issued: number;
    skipped: number;
    failed: number;
    cancelled: number;
    stock: number | null;
    expiresAt: number;
    createdAt: number;
    administratorId: number;
};
export const couponCampaignStatuses: Record<string, string> = {
    draft: "待确认",
    queued: "发放中",
    completed: "已完成",
    cancelled: "已取消",
    expired: "预览过期",
};
export const couponRecipientStatuses: Record<string, string> = {
    pending: "待发放",
    issued: "已发放",
    skipped: "已跳过",
    failed: "失败",
    cancelled: "已取消",
};
export const couponRecipientReasons: Record<string, string> = {
    issued: "成功",
    already_claimed: "已领取或已使用",
    account_disabled: "账户已禁用",
    record_missing: "用户或模板已删除",
    expired: "优惠券已过期",
    delivery_failed: "发放失败，库存已退回",
    cancelled: "已取消",
};
