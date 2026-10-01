export interface UserFilter {
    key: string;
    condition: string;
    value: string | number;
}
export const userFilterFields: [string, string, string[]][] = [
    ["email", "邮箱", ["模糊", "="]],
    ["id", "用户 ID", ["=", ">=", ">", "<", "<="]],
    ["plan_id", "套餐", ["="]],
    ["transfer_enable", "流量限额（GB）", [">=", ">", "<", "<="]],
    ["d", "已用下行（GB）", [">=", ">", "<", "<="]],
    ["device_limit", "设备限制", ["=", ">=", ">", "<", "<="]],
    ["expired_at", "到期时间", [">=", ">", "<", "<="]],
    ["uuid", "UUID", ["="]],
    ["token", "Token", ["="]],
    ["banned", "账户状态", ["="]],
    ["invite_by_email", "邀请人邮箱", ["模糊", "="]],
    ["invite_user_id", "邀请人 ID", ["="]],
    ["remarks", "备注", ["模糊"]],
    ["is_admin", "管理员", ["="]],
];
export function normalizeUserFilters(filters: UserFilter[]): UserFilter[] {
    return filters.map((filter) => {
        const spec = userFilterFields.find(([key]) => key === filter.key);
        if (!spec || !spec[2].includes(filter.condition))
            throw new Error("筛选字段或条件无效");
        if (String(filter.value).trim() === "")
            throw new Error("请填写每个筛选条件的值");
        if (filter.key === "expired_at") {
            const value = /^\d+$/.test(String(filter.value))
                ? Number(filter.value)
                : Math.floor(new Date(filter.value).getTime() / 1000);
            if (!Number.isFinite(value)) throw new Error("到期时间格式无效");
            return { ...filter, value };
        }
        if (
            [
                "id",
                "transfer_enable",
                "device_limit",
                "d",
                "invite_user_id",
            ].includes(filter.key) &&
            (!Number.isFinite(Number(filter.value)) || Number(filter.value) < 0)
        )
            throw new Error("数值筛选条件必须是非负数字");
        return { ...filter };
    });
}
export function emailSearchFilters(
    filters: UserFilter[],
    email: string,
): UserFilter[] {
    return [
        ...filters.filter((f) => f.key !== "email"),
        ...(email.trim()
            ? [{ key: "email", condition: "模糊", value: email.trim() }]
            : []),
    ];
}
export const userSortFields: [string, string][] = [
    ["created_at", "加入时间"],
    ["id", "用户 ID"],
    ["banned", "状态"],
    ["plan_id", "套餐"],
    ["group_id", "权限组"],
    ["total_used", "已用流量"],
    ["transfer_enable", "流量限额"],
    ["device_limit", "设备限制"],
    ["expired_at", "到期时间"],
    ["balance", "余额"],
    ["commission_balance", "佣金"],
];
