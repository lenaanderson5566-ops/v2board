import type { ReactNode } from "react";
import { StatusBadge, type StatusTone } from "./StatusBadge";

const states: Record<string, [string, StatusTone]> = {
    success: ["成功", "success"], failed: ["失败", "danger"], failure: ["失败", "danger"],
    error: ["错误", "danger"], blocked: ["已阻止", "danger"], allowed: ["已允许", "success"],
    pending: ["待处理", "warning"], running: ["运行中", "info"], paused: ["已暂停", "warning"],
    completed: ["已完成", "success"], cancelled: ["已取消", "neutral"],
    warning: ["警告", "warning"], critical: ["严重错误", "danger"], alert: ["告警", "danger"],
    emergency: ["紧急错误", "danger"], info: ["信息", "info"], debug: ["调试", "neutral"], notice: ["通知", "info"],
};
for (const [tone, labels] of Object.entries({
    success: ["成功", "正常", "有效", "已发放", "已完成", "已回复", "已启用"],
    danger: ["失败", "错误", "封禁", "无效", "已阻止"],
    warning: ["待确认", "待支付", "待回复", "待处理"],
    info: ["开通中", "运行中", "处理中"],
    neutral: ["已取消", "已折抵", "已关闭", "已停用"],
})) for (const label of labels) states[label] = [label, tone as StatusTone];

export function AdminStatus({ value, login = false }: { value: unknown; login?: boolean }) {
    let state = states[String(value).toLowerCase()];
    if (login) state = value === true || value === 1 || value === "1"
        ? ["登录成功", "success"] : value === false || value === 0 || value === "0"
          ? ["登录失败", "danger"] : ["未知", "neutral"];
    return <StatusBadge tone={state?.[1] || "neutral"}>{state?.[0] || (value == null || value === "" ? "未知" : String(value))}</StatusBadge>;
}

// Only decorate known status fields; numeric business enums need their own renderer.
export function adminStatusCell(key: string, label: string, value: unknown, rendered?: ReactNode): ReactNode {
    if (rendered !== undefined && typeof rendered !== "string" && typeof rendered !== "number") return rendered;
    if (key === "is_success") return <AdminStatus value={value} login />;
    if (["is_enabled", "enabled", "show"].includes(key) && rendered === undefined) {
        const on = value === true || value === 1 || value === "1";
        const off = value === false || value === 0 || value === "0";
        const names = label === "销售状态" ? ["销售中", "已停售"] : label === "显示" ? ["已显示", "已隐藏"] : ["已启用", "已停用"];
        return <StatusBadge tone={on ? "success" : "neutral"}>{on ? names[0] : off ? names[1] : "未知"}</StatusBadge>;
    }
    if (key === "http_status") {
        const code = Number(value);
        return <StatusBadge tone={code >= 400 && code <= 599 ? "danger" : code >= 200 && code < 300 ? "success" : code >= 300 && code < 400 ? "info" : "neutral"}>{value == null || value === "" ? "未知" : String(value)}</StatusBadge>;
    }
    if (rendered === undefined && (label === "订单状态" || key === "commission_status")) {
        const labels = key === "commission_status" ? ["待确认", "有效", "已发放", "无效"] : ["待支付", "开通中", "已取消", "已完成", "已折抵"];
        return <AdminStatus value={value == null || value === "" ? null : labels[Number(value)] ?? value} />;
    }
    if (key === "status" || key === "commission_status" || (key === "level" && label === "级别")) return <AdminStatus value={rendered ?? value} />;
    return rendered ?? (value != null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "—"));
}
