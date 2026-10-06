export function adminUserLabel(row: { user_id?: number | string | null; email?: string | null }): string {
    const id = row.user_id ? `ID: ${row.user_id}` : "未识别用户";
    return row.email ? `${row.email} · ${id}` : id;
}
