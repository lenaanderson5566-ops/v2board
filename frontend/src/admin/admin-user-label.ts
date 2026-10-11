export function adminUserLabel(row: {
    user_id?: number | string | null;
    email?: string | null;
}): string {
    const id = row.user_id ? `ID: ${row.user_id}` : "未识别用户";
    return `${id} · ${row.email && row.email !== "null" ? row.email : "邮箱不可用"}`;
}
