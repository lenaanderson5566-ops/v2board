import type { Field } from "./ui";
export const resetOptions: [string, string][] = [
    ["0", "每月首日"],
    ["1", "每月按到期日"],
    ["2", "不重置"],
    ["3", "每年首日"],
    ["4", "每年按到期日"],
];
const choices: Record<string, [string, string][]> = {
    reset_traffic_method: resetOptions,
    ticket_status: [
        ["0", "所有用户可提交"],
        ["1", "仅有已付订单的用户"],
        ["2", "关闭所有工单提交"],
    ],
    show_subscribe_method: [
        ["0", "固定访问令牌"],
        ["1", "每日轮换访问令牌"],
        ["2", "按时间轮换访问令牌"],
    ],
    device_limit_mode: [
        ["0", "按各节点设备数累计"],
        ["1", "按 IP 去重统计"],
    ],
    email_encryption: [
        ["", "不加密"],
        ["tls", "STARTTLS"],
        ["ssl", "SSL/TLS"],
    ],
    new_order_event_id: [
        ["0", "保持已有流量"],
        ["1", "重置已用流量"],
    ],
    renew_order_event_id: [
        ["0", "保持已有流量"],
        ["1", "重置已用流量"],
    ],
    change_order_event_id: [
        ["0", "保持已有流量"],
        ["1", "重置已用流量"],
    ],
};
export function configField(
    key: string,
    value: unknown,
    rule: unknown,
    label: string,
): Field {
    const validation = Array.isArray(rule)
        ? rule.join("|")
        : String(rule || "");
    const enumValues = validation.match(/(?:^|\|)in:([^|]+)/)?.[1].split(",");
    if (choices[key])
        return { key, label, type: "select", options: choices[key] };
    if (
        enumValues?.length === 2 &&
        enumValues.includes("0") &&
        enumValues.includes("1")
    )
        return { key, label, type: "switch" };
    if (enumValues)
        return {
            key,
            label,
            type: "select",
            options: enumValues.map((v) => [v, v]),
        };
    const secret = /(?:password|token)$/.test(key) || key === "recaptcha_key";
    const type: Field["type"] =
        key === "custom_footer_html"
            ? "textarea"
            : secret
              ? "password"
              : Array.isArray(value) || validation.includes("array")
                ? "json"
                : /integer|numeric/.test(validation) ||
                    typeof value === "number"
                  ? "number"
                  : validation.includes("url")
                    ? "url"
                    : "text";
    return {
        key,
        label,
        type,
        step: validation.includes("integer") ? 1 : undefined,
        min: type === "number" ? 0 : undefined,
        max: /commission_distribution_l|invite_commission/.test(key)
            ? 100
            : undefined,
        hint:
            key === "custom_footer_html"
                ? "支持 HTML 和管理员自定义脚本，展示在用户端页面底部。"
                : type === "json"
                  ? "填写 JSON 数组或对象；留空将清除当前内容。"
                  : undefined,
    };
}
