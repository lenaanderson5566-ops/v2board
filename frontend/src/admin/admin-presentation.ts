import type { Field } from "../shared/ui";
import reference from "./admin-settings-reference.json";
export function settingsPresentation(group: string, fields: Field[]): Field[] {
    const entries =
        (
            reference as Record<
                string,
                Record<
                    string,
                    {
                        label: string;
                        hint?: string;
                        placeholder?: string;
                        child: boolean;
                        line: number;
                    }
                >
            >
        )[group] || {};
    return fields
        .filter(field => !(group === "site" && field.key === "currency_symbol"))
        .map((field) => ({ ...field, ...entries[field.key] }))
        .sort(
            (a, b) =>
                (entries[a.key]?.line ?? Infinity) -
                (entries[b.key]?.line ?? Infinity),
        );
}
export function formPresentation(fields: Field[], kind: string): Field[] {
    const prices = [
        "month_price",
        "quarter_price",
        "half_year_price",
        "year_price",
        "two_year_price",
        "three_year_price",
        "onetime_price",
        "reset_price",
    ];
    const order =
        kind === "plans"
            ? [
                  "name",
                  "content",
                  ...prices,
                  "transfer_enable",
                  "device_limit",
                  "group_id",
                  "reset_traffic_method",
                  "capacity_limit",
                  "speed_limit",
                  "force_update",
              ]
            : kind === "nodes"
              ? [
                    "name",
                    "rate",
                    "tags",
                    "group_id",
                    "host",
                    "listen_ip",
                    "port",
                    "server_port",
                    "protocol",
                    "tls",
                    "network",
                    "parent_id",
                    "route_id",
                ]
              : kind === "coupons"
                ? [
                      "name",
                      "code",
                      "type",
                      "value",
                      "started_at",
                      "ended_at",
                      "limit_use",
                      "limit_use_with_user",
                      "limit_plan_ids",
                      "limit_period",
                      "generate_count",
                  ]
                : [];
    const position = (key: string) => {
        const i = order.indexOf(key);
        return i < 0 ? order.length : i;
    };
    return fields
        .map((field) => {
            if (kind === "plans") {
                if (prices.includes(field.key))
                    return {
                        ...field,
                        label: field.label.replace(/（(?:元|CNY)）$/, ""),
                        columns: prices.indexOf(field.key) < 6 ? 2 : 6,
                        unit: "CNY",
                        hint: undefined,
                        section:
                            field.key === prices[0] ? "售价设置" : undefined,
                    };
                const labels: Record<string, string> = {
                    content: "套餐描述",
                    transfer_enable: "套餐流量",
                    capacity_limit: "最大容纳用户量",
                    speed_limit: "限速",
                    reset_traffic_method: "流量重置方式",
                    force_update: "强制更新到用户",
                };
                return {
                    ...field,
                    label: labels[field.key] || field.label,
                    unit:
                        field.key === "transfer_enable"
                            ? "GB"
                            : field.key === "speed_limit"
                              ? "Mbps"
                              : undefined,
                };
            }
            if (kind === "nodes")
                return {
                    ...field,
                    columns:
                        field.key === "name"
                            ? 8
                            : field.key === "rate"
                              ? 4
                              : [
                                      "host",
                                      "listen_ip",
                                      "port",
                                      "server_port",
                                  ].includes(field.key)
                                ? 6
                                : 12,
                    unit: field.key === "rate" ? "x" : undefined,
                };
            if (kind === "coupons")
                return {
                    ...field,
                    columns: [
                        "type",
                        "value",
                        "started_at",
                        "ended_at",
                    ].includes(field.key)
                        ? 6
                        : 12,
                };
            return field;
        })
        .sort((a, b) => position(a.key) - position(b.key));
}
