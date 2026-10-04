import { ContentComposer } from "./ContentComposer";
import { PlanDescription } from "./PlanDescription";
import { AdminPlanAutoTranslation } from "./AdminPlanAutoTranslation";
import { AdminMailPreview } from "./AdminMailPreview";
import { formPresentation, settingsPresentation } from "./admin-presentation";
import { useState, useEffect, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import {
    admin,
    ops,
    request,
    download,
    query,
    rows,
    bytes,
    money,
    date,
    type Row,
} from "./api";
import {
    useData,
    State,
    Panel,
    Metric,
    Table,
    Editor,
    Modal,
    Pager,
    Reload,
    Empty,
    Html,
    type Field,
} from "./ui";
import { SortButton, QueueDetails } from "./admin-tools";
import { AdminSwitch } from "./admin-switch";
import { sortPayload } from "./admin-actions";
import { configField, resetOptions } from "./admin-fields";
import {
    paymentFields,
    paymentInitial,
    paymentPayload,
} from "./payment-fields";
import {
    settingsFields,
    linkSettings,
    validateSettings,
    changedSettings,
    resourceFields,
    linkResource,
    validateResource,
    nodeFields,
    linkNode,
} from "./admin-linkage";
import {
    nodeSettingsFields,
    nodeSettingsInitial,
    nodeSettingsPayload,
} from "./node-settings";
const f = (
    key: string,
    label: string,
    type: Field["type"] = "text",
    required = false,
): Field => ({ key, label, type, required });
const toggle = (key: string, label: string): Field => ({
    key,
    label,
    type: "switch",
    options: [
        ["1", "开启"],
        ["0", "关闭"],
    ],
});
export interface Resource {
    title: string;
    fetch: string;
    sort?: string;
    sortKind?: "plans" | "knowledge";
    save?: string;
    drop?: string;
    fields: Field[];
    columns: [string, string, ((r: Row) => React.ReactNode)?][];
    defaults?: Row;
    actions?: [string, string, Row?][];
    key?: string;
    create?: boolean;
}
const created: [string, string, ((r: Row) => React.ReactNode)?] = [
    "created_at",
    "创建时间",
    (r) => date(r.created_at),
];
const name: [string, string] = ["name", "名称"];
const price = (key: string, label: string): Field => ({
    ...f(key, label + "（元）", "number"),
    scale: 100,
    step: 0.01,
    hint:
        key === "onetime_price"
            ? "额度包价格；流量 (GB) 为额度数量。仅在用户的额度入口展示，可独立使用，套餐重置不会补回额度。"
            : "留空表示不提供该支付周期",
});
export const resources: Record<string, Resource> = {
    plans: {
        title: "订阅管理",
        fetch: admin("plan/fetch"),
        sort: admin("plan/sort"),
        sortKind: "plans",
        save: admin("plan/save"),
        drop: admin("plan/drop"),
        columns: [
            ["show", "销售状态"],
            name,
            ["count", "统计"],
            ["transfer_enable", "流量 (GB)"],
            ["device_limit", "设备数限制"],
            ...[
                "month_price",
                "quarter_price",
                "half_year_price",
                "year_price",
                "two_year_price",
                "three_year_price",
                "onetime_price",
                "reset_price",
            ].map(
                (key, i) =>
                    [
                        key,
                        [
                            "月付",
                            "季付",
                            "半年付",
                            "年付",
                            "两年付",
                            "三年付",
                            "额度包",
                            "重置包",
                        ][i],
                        (r: Row) => (r[key] == null ? "—" : money(r[key])),
                    ] as [string, string, (r: Row) => ReactNode],
            ),
            ["group_id", "权限组"],
            ["renew", "允许续费"],
        ],
        fields: [
            f("name", "套餐名称", "text", true),
            f("group_id", "权限组 ID", "number", true),
            f("transfer_enable", "流量 (GB)", "number", true),
            f("device_limit", "设备数限制", "number"),
            f("speed_limit", "速率 (Mbps)", "number"),
            f("capacity_limit", "用户容量", "number"),
            ...[
                "month_price",
                "quarter_price",
                "half_year_price",
                "year_price",
                "two_year_price",
                "three_year_price",
                "onetime_price",
                "reset_price",
            ].map((k, i) =>
                price(
                    k,
                    [
                        "月付",
                        "季付",
                        "半年付",
                        "年付",
                        "两年付",
                        "三年付",
                        "额度包",
                        "重置流量",
                    ][i],
                ),
            ),
            {
                key: "reset_traffic_method",
                label: "流量重置模式",
                type: "select",
                nullable: true,
                options: [["", "跟随系统设置"], ...resetOptions],
            },
            f("content", "套餐说明 HTML", "textarea"),
            {
                ...toggle("force_update", "更新到现有用户"),
                hint: "同步设备、速率和权限组；流量配额仅更新未转换为额度的套餐用户，已购额度保持不变。",
            },
        ],
        defaults: { transfer_enable: 100 },
        actions: [
            ["展示", admin("plan/update"), { show: 1 }],
            ["隐藏", admin("plan/update"), { show: 0 }],
            ["开启续费", admin("plan/update"), { renew: 1 }],
            ["关闭续费", admin("plan/update"), { renew: 0 }],
        ],
    },
    groups: {
        title: "权限组管理",
        fetch: admin("server/group/fetch"),
        save: admin("server/group/save"),
        drop: admin("server/group/drop"),
        columns: [
            ["id", "组ID"],
            ["name", "组名称"],
            ["user_count", "用户数量"],
            ["server_count", "节点数量"],
        ],
        fields: [f("name", "权限组名称", "text", true)],
    },
    routes: {
        title: "路由管理",
        fetch: admin("server/route/fetch"),
        save: admin("server/route/save"),
        drop: admin("server/route/drop"),
        columns: [
            ["id", "ID"],
            ["remarks", "备注"],
            [
                "match",
                "匹配数量",
                (r) => (Array.isArray(r.match) ? r.match.length : 0),
            ],
            ["action", "动作"],
        ],
        fields: [
            f("remarks", "备注", "text", true),
            f("match", "匹配条件", "json", true),
            {
                key: "action",
                label: "动作",
                type: "select",
                options: [
                    ["block", "阻断"],
                    ["dns", "DNS"],
                    ["block_ip", "阻断 IP"],
                    ["block_port", "阻断端口"],
                    ["protocol", "协议识别"],
                    ["route", "路由"],
                    ["route_ip", "按 IP 路由"],
                    ["default_out", "默认出口"],
                ],
            },
            f("action_value", "动作参数"),
        ],
        defaults: { match: [], action: "block" },
    },
    users: {
        title: "用户管理",
        fetch: admin("user/fetch"),
        save: admin("user/update"),
        columns: [
            ["id", "ID"],
            ["email", "邮箱"],
            ["credit_balance", "剩余额度", (r) => bytes(r.credit_balance || 0)],
            [
                "banned",
                "状态",
                (r) => (
                    <span
                        className={`admin-status ${r.banned ? "error" : "success"}`}
                    >
                        {r.banned ? "封禁" : "正常"}
                    </span>
                ),
            ],
            ["plan_name", "订阅"],
            ["group_id", "权限组"],
            [
                "total_used",
                "已用(G)",
                (r) => (Number(r.total_used || 0) / 1073741824).toFixed(2),
            ],
            [
                "transfer_enable",
                "流量(G)",
                (r) => (Number(r.transfer_enable || 0) / 1073741824).toFixed(2),
            ],
            [
                "device_limit",
                "设备数",
                (r) => `${r.alive_ip || 0} / ${r.device_limit || "不限"}`,
            ],
            ["expired_at", "到期时间", (r) => date(r.expired_at)],
            ["balance", "余额", (r) => money(r.balance)],
            ["commission_balance", "佣金", (r) => money(r.commission_balance)],
            ["created_at", "加入时间", (r) => date(r.created_at)],
        ],
        fields: [
            f("email", "邮箱", "text", true),
            f("password", "新密码（留空不修改）", "password"),
            f("plan_id", "套餐 ID", "number"),
            f("transfer_enable", "流量 (GB)", "number"),
            f("u", "已用上传（GB）", "number"),
            f("d", "已用下载（GB）", "number"),
            { ...f("balance", "余额（元）", "number"), scale: 100, step: 0.01 },
            f("expired_at", "到期时间", "datetime-local"),
            f("device_limit", "设备限制", "number"),
            f("speed_limit", "速率限制", "number"),
            toggle("banned", "禁用账户"),
            toggle("is_admin", "管理员"),
            toggle("is_staff", "员工"),
            f("discount", "专属折扣 (%)", "number"),
            f("commission_rate", "佣金比例 (%)", "number"),
            {
                key: "commission_type",
                label: "返利类型",
                type: "select",
                options: [
                    ["0", "跟随系统设置"],
                    ["1", "循环返利"],
                    ["2", "首次返利"],
                ],
            },
            {
                ...f("commission_balance", "佣金余额（元）", "number"),
                scale: 100,
                step: 0.01,
            },
            f("invite_user_email", "邀请人邮箱（留空解除）", "email"),
            f("remarks", "备注", "textarea"),
        ],
        create: false,
        actions: [
            ["重置订阅", admin("user/resetSecret")],
            ["删除", admin("user/delUser")],
        ],
    },
    orders: {
        title: "订单管理",
        fetch: admin("order/fetch"),
        columns: [
            ["trade_no", "订单号"],
            [
                "type",
                "类型",
                (r) =>
                    ["", "新购", "续费", "升级", "流量重置", "额度购买"][
                        Number(r.type)
                    ] || r.type,
            ],
            ["plan_name", "订阅计划"],
            [
                "period",
                "周期",
                (r) =>
                    (
                        ({
                            month_price: "月付",
                            quarter_price: "季付",
                            half_year_price: "半年付",
                            year_price: "年付",
                            two_year_price: "两年付",
                            three_year_price: "三年付",
                            onetime_price: "额度包",
                            reset_price: "重置包",
                        }) as Row
                    )[r.period] || r.period,
            ],
            ["user_id", "用户 ID"],
            ["plan_id", "套餐 ID"],
            [
                "credit_bytes",
                "额度数量",
                (r) => (r.credit_bytes ? bytes(r.credit_bytes) : "—"),
            ],
            ["total_amount", "金额", (r) => money(r.total_amount)],
            [
                "commission_balance",
                "佣金金额",
                (r) => money(r.commission_balance),
            ],
            [
                "commission_status",
                "佣金状态",
                (r) =>
                    ["待确认", "有效", "已发放", "无效"][
                        Number(r.commission_status)
                    ],
            ],
            [
                "status",
                "状态",
                (r) =>
                    ["待支付", "开通中", "已取消", "已完成", "已折抵"][
                        r.status
                    ],
            ],
            created,
        ],
        fields: [],
        actions: [
            ["标记已付款", admin("order/paid")],
            ["取消", admin("order/cancel")],
        ],
    },
    notices: {
        title: "公告管理",
        fetch: admin("notice/fetch"),
        save: admin("notice/save"),
        drop: admin("notice/drop"),
        columns: [["id", "#"], ["show", "显示"], ["title", "标题"], created],
        fields: [
            f("title", "公告标题", "text", true),
            f("img_url", "封面 URL"),
            f("tags", "适用标签数组（留空表示全部）", "json"),
            { ...f("content", "内容", "textarea", true), markdown: true },
        ],
        actions: [["切换展示", admin("notice/show")]],
    },
    knowledge: {
        title: "知识库管理",
        fetch: admin("knowledge/fetch"),
        sort: admin("knowledge/sort"),
        sortKind: "knowledge",
        save: admin("knowledge/save"),
        drop: admin("knowledge/drop"),
        columns: [
            ["id", "ID"],
            ["show", "显示"],
            ["title", "标题"],
            ["category", "分类"],
            ["language", "语言"],
            ["updated_at", "更新时间", (r) => date(r.updated_at)],
        ],
        fields: [
            f("title", "标题", "text", true),
            f("category", "分类", "text", true),
            f("language", "语言代码", "text", true),
            { ...f("body", "内容", "textarea", true), markdown: true },
            f("sort", "排序", "number"),
        ],
        defaults: { language: "zh-CN", sort: 0 },
        actions: [["切换展示", admin("knowledge/show")]],
    },
    coupons: {
        title: "优惠券管理",
        fetch: admin("coupon/fetch"),
        save: admin("coupon/generate"),
        drop: admin("coupon/drop"),
        create: true,
        columns: [
            ["id", "ID"],
            ["show", "启用"],
            ["name", "券名称"],
            [
                "type",
                "类型",
                (r) =>
                    Number(r.type) === 1
                        ? `金额优惠 ${money(r.value)}`
                        : `比例优惠 ${r.value}%`,
            ],
            ["code", "券码"],
            [
                "limit_use",
                "剩余次数",
                (r) => (r.limit_use == null ? "不限" : r.limit_use),
            ],
            [
                "started_at",
                "有效期",
                (r) => `${date(r.started_at)} — ${date(r.ended_at)}`,
            ],
        ],
        fields: [
            f("name", "名称", "text", true),
            f("code", "指定兑换码（可选）"),
            {
                key: "type",
                label: "优惠类型",
                type: "select",
                options: [
                    ["1", "固定金额（元）"],
                    ["2", "百分比"],
                ],
            },
            f("value", "优惠值", "number", true),
            f("generate_count", "生成数量", "number"),
            f("limit_use", "使用次数", "number"),
            f("limit_use_with_user", "每个用户使用次数", "number"),
            f("started_at", "开始时间", "datetime-local", true),
            f("ended_at", "截止时间", "datetime-local", true),
            f("limit_plan_ids", "限制套餐 ID 数组", "json"),
            f("limit_period", "限制周期数组", "json"),
        ],
        defaults: { type: 1, generate_count: 1 },
        actions: [["切换启用", admin("coupon/show")]],
    },
    giftcards: {
        title: "礼品卡管理",
        fetch: admin("giftcard/fetch"),
        save: admin("giftcard/generate"),
        drop: admin("giftcard/drop"),
        columns: [
            ["id", "ID"],
            name,
            [
                "type",
                "类型",
                (r) =>
                    [
                        "",
                        "余额",
                        "延长订阅",
                        "增加流量",
                        "重置流量",
                        "开通套餐",
                    ][Number(r.type)],
            ],
            ["value", "面值"],
            ["plan_id", "套餐"],
            ["code", "卡密"],
            [
                "limit_use",
                "剩余次数",
                (r) => (r.limit_use == null ? "不限" : r.limit_use),
            ],
            [
                "started_at",
                "有效期",
                (r) => `${date(r.started_at)} — ${date(r.ended_at)}`,
            ],
            ["status", "状态"],
        ],
        fields: [
            f("name", "名称", "text", true),
            f("generate_count", "数量", "number"),
            f("value", "金额（分）", "number", true),
            {
                key: "type",
                label: "礼品卡类型",
                type: "select",
                options: [
                    ["1", "余额（元）"],
                    ["2", "延长订阅（天）"],
                    ["3", "增加流量（GB）"],
                    ["4", "重置流量"],
                    ["5", "开通套餐"],
                ],
            },
            f("plan_id", "套餐 ID", "number"),
            f("started_at", "开始时间", "datetime-local", true),
            f("ended_at", "到期时间", "datetime-local", true),
            f("limit_use", "可用次数", "number"),
        ],
        defaults: { generate_count: 1, type: 1 },
    },
    risk: {
        title: "风控规则",
        fetch: ops("risk/rule/fetch"),
        save: ops("risk/rule/update"),
        create: false,
        key: "rule_key",
        columns: [
            ["rule_key", "规则标识"],
            name,
            ["scene", "场景"],
            ["risk_level", "风险级别"],
            ["enabled", "启用"],
        ],
        fields: [
            f("rule_key", "规则标识", "text", true),
            f("name", "名称"),
            f("description", "说明", "textarea"),
            {
                key: "risk_level",
                label: "风险级别",
                type: "select",
                options: [
                    ["low", "低"],
                    ["medium", "中"],
                    ["high", "高"],
                ],
            },
            toggle("enabled", "启用"),
            f("sort", "排序", "number"),
            f("thresholds", "规则阈值", "json"),
        ],
        actions: [["恢复默认", ops("risk/rule/reset")]],
    },
    clients: {
        title: "客户端策略",
        fetch: ops("client/strategy/fetch"),
        save: ops("client/strategy/update"),
        drop: ops("client/strategy/delete"),
        key: "client_type",
        columns: [
            ["client_name", "客户端"],
            ["client_type", "标识"],
            ["min_version", "最低版本"],
            ["is_enabled", "启用"],
            ["subscribe_count_24h", "24 小时订阅"],
        ],
        fields: [
            f("client_type", "客户端标识", "text", true),
            f("client_name", "名称"),
            f("min_version", "最低版本"),
            toggle("is_enabled", "启用"),
            f("sort", "排序", "number"),
        ],
        defaults: { is_enabled: 1, sort: 0 },
    },
    "blacklist-ip": {
        title: "IP 黑名单",
        fetch: ops("risk/blacklist/ip/fetch"),
        save: ops("risk/blacklist/ip/update"),
        drop: ops("risk/blacklist/ip/delete"),
        columns: [
            ["id", "ID"],
            ["value", "IP / CIDR"],
            ["reason", "原因"],
            ["is_enabled", "启用"],
        ],
        fields: [
            f("value", "IP 地址或 CIDR", "text", true),
            f("reason", "原因"),
            toggle("is_enabled", "启用"),
            f("expired_at", "到期时间", "datetime-local"),
        ],
        defaults: { type: "ip", is_enabled: 1 },
    },
    "blacklist-ua": {
        title: "UA 黑名单",
        fetch: ops("risk/blacklist/ua/fetch"),
        save: ops("risk/blacklist/ua/update"),
        drop: ops("risk/blacklist/ua/delete"),
        columns: [
            ["id", "ID"],
            ["ua_raw", "原始 UA"],
            ["value", "UA 哈希"],
            ["is_enabled", "启用"],
        ],
        fields: [
            f("ua_raw", "原始 UA", "textarea"),
            f("value", "UA 哈希（可选）"),
            f("reason", "原因"),
            toggle("is_enabled", "启用"),
        ],
        defaults: { type: "ua_hash", is_enabled: 1 },
    },
    online: {
        title: "在线用户",
        fetch: ops("risk/online-user/fetch"),
        columns: [
            ["user_id", "用户 ID"],
            ["email", "邮箱"],
            ["ip", "IP 地址"],
            ["node", "节点"],
            ["online_at", "上线时间", (r) => date(r.online_at)],
        ],
        fields: [],
    },
    usage: {
        title: "用户使用情况",
        fetch: ops("risk/user-usage/fetch"),
        columns: [
            ["user_id", "用户 ID"],
            ["email", "邮箱"],
            ["subscription_plan", "订阅套餐"],
            ["last_subscribe_at", "最近订阅", (r) => date(r.last_subscribe_at)],
            ["last_online_ip", "在线 IP"],
            ["last_online_node", "在线节点"],
            ["recharge_total", "充值金额"],
            ["balance", "余额", (r) => money(r.balance)],
        ],
        fields: [],
    },
    "log-login": {
        title: "登录日志",
        fetch: ops("log/login/fetch"),
        columns: [
            ["user_id", "用户 ID"],
            ["email", "邮箱"],
            ["ip", "IP"],
            ["country", "国家"],
            ["city", "城市"],
            ["user_agent", "客户端"],
            created,
        ],
        fields: [],
    },
    "log-subscribe": {
        title: "订阅日志",
        fetch: ops("log/subscribe/fetch"),
        columns: [
            ["user_id", "用户 ID"],
            ["email", "邮箱"],
            ["ip", "IP"],
            ["client_type", "客户端类型"],
            ["user_agent", "UA"],
            created,
        ],
        fields: [],
    },
    "log-connection": {
        title: "连接日志",
        fetch: ops("log/user-connection/fetch"),
        columns: [
            ["user_id", "用户 ID"],
            ["email", "邮箱"],
            ["ip", "IP"],
            ["node", "节点"],
            ["connected_at", "连接时间", (r) => date(r.connected_at)],
        ],
        fields: [],
    },
    "log-risk": {
        title: "风控命中日志",
        fetch: ops("log/rule-hit/fetch"),
        columns: [
            ["user_id", "用户 ID"],
            ["rule_key", "规则"],
            ["ip", "IP"],
            ["status", "处理结果"],
            ["hit_at", "命中时间", (r) => date(r.hit_at)],
        ],
        fields: [],
    },
    "system-log": {
        title: "系统日志",
        fetch: admin("system/getSystemLog"),
        columns: [
            ["level", "级别"],
            ["message", "消息"],
            ["created_at", "时间", (r) => date(r.created_at)],
        ],
        fields: [],
    },
};
export function ResourcePage({
    resource,
    queryParams = {},
    toolbar,
    extraActions,
    searchable = true,
    pageSize = 20,
    onTotal,
    tableSort,
    onTableSort,
}: {
    resource: Resource;
    queryParams?: Row;
    toolbar?: ReactNode;
    extraActions?: (row: Row, context?: boolean) => ReactNode;
    searchable?: boolean;
    pageSize?: number;
    onTotal?: (total: number) => void;
    tableSort?: { key: string; direction: string; fields: string[] };
    onTableSort?: (key: string, direction: string) => void;
}) {
    const groups = useData<Row[]>(
        resource.fields.some((f) => f.key === "group_id")
            ? admin("server/group/fetch")
            : "",
    );
    const plans = useData<Row[]>(
        resource.fields.some((f) =>
            ["plan_id", "limit_plan_ids"].includes(f.key),
        )
            ? admin("plan/fetch")
            : "",
    );
    const categories = useData<string[]>(
        resource === resources.knowledge ? admin("knowledge/getCategory") : "",
    );
    const editorFields = resource.fields.map((field) =>
        field.key === "category"
            ? { ...field, suggestions: categories.data || [] }
            : field.key === "language"
              ? {
                    ...field,
                    suggestions: [
                        "zh-CN",
                        "zh-TW",
                        "en-US",
                        "ja-JP",
                        "ko-KR",
                        "vi-VN",
                        "ru-RU",
                        "fa-IR",
                    ],
                }
              : field.key === "group_id"
                ? {
                      ...field,
                      label: "权限组",
                      type: "select" as const,
                      options: rows(groups.data).map(
                          (r) => [String(r.id), r.name] as [string, string],
                      ),
                  }
                : field.key === "plan_id"
                  ? {
                        ...field,
                        label: "套餐",
                        hint:
                            resource === resources.users
                                ? "选择套餐会同步流量、设备和速率限制；到期时间与余额保持当前输入。"
                                : !rows(plans.data).length
                                  ? "请先到套餐管理创建套餐。"
                                  : undefined,
                        type: "select" as const,
                        nullable: true,
                        options: [
                            ["", "不指定套餐"] as [string, string],
                            ...rows(plans.data).map(
                                (r) =>
                                    [String(r.id), r.name] as [string, string],
                            ),
                        ],
                    }
                  : field.key === "limit_plan_ids"
                    ? {
                          ...field,
                          label: "适用套餐（不选择表示全部）",
                          type: "multiselect" as const,
                          options: rows(plans.data).map(
                              (r) => [String(r.id), r.name] as [string, string],
                          ),
                      }
                    : field.key === "limit_period"
                      ? {
                            ...field,
                            label: "适用周期（不选择表示全部）",
                            type: "multiselect" as const,
                            options: [
                                ["month_price", "月付"],
                                ["quarter_price", "季付"],
                                ["half_year_price", "半年付"],
                                ["year_price", "年付"],
                                ["two_year_price", "两年付"],
                                ["three_year_price", "三年付"],
                                ["onetime_price", "额度包"],
                                ["reset_price", "重置流量"],
                            ] as [string, string][],
                        }
                      : field,
    );
    const [page, setPage] = useState(1),
        [search, setSearch] = useState(""),
        [editing, setEditing] = useState<Row | null>(null),
        [error, setError] = useState("");
    const d = useData<Row[]>(
        query(resource.fetch, {
            current: page,
            page: page,
            pageSize,
            page_size: pageSize,
            email: resource.title.includes("日志") ? search : undefined,
            keyword: resource.title.includes("黑名单") ? search : undefined,
            ...queryParams,
        }),
    );
    useEffect(() => {
        onTotal?.(d.total);
    }, [d.total, onTotal]);
    const key = resource.key || "id";
    async function action(path: string, r: Row, extra: Row = {}) {
        if (
            !confirm(
                resource === resources.users
                    ? path.endsWith("resetSecret")
                        ? `重置 ${r.email} 的 UUID 和订阅链接？旧链接和客户端凭据将失效。`
                        : `删除 ${r.email}？该用户的订单、邀请码和工单也会被永久删除。`
                    : "确认执行此操作？",
            )
        )
            return;
        try {
            await request(path, {
                [key]: r[key],
                id: r.id,
                trade_no: r.trade_no,
                ...extra,
            });
            d.reload();
        } catch (e) {
            setError((e as Error).message);
        }
    }
    const list = (d.data || []).filter(
        (r) =>
            !search ||
            Object.values(r).some((v) =>
                String(v ?? "")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
            ),
    );
    return (
        <>
            <Panel
                title={resource.title}
                actions={
                    <>
                        {searchable && (
                            <div className="search">
                                <Search size={16} />
                                <input
                                    placeholder="搜索当前列表…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    aria-label="搜索列表"
                                />
                            </div>
                        )}
                        <Reload onClick={d.reload} />
                        {resource.save && resource.create !== false && (
                            <button
                                className="primary"
                                onClick={() =>
                                    setEditing({ ...resource.defaults })
                                }
                            >
                                <Plus size={16} />
                                新建
                            </button>
                        )}
                    </>
                }
            >
                {resource.sort && resource.sortKind && (
                    <div className="pad">
                        <SortButton
                            path={resource.sort}
                            kind={resource.sortKind}
                            items={rows(d.data)}
                            onSaved={d.reload}
                        />
                    </div>
                )}
                {toolbar}
                <State {...d} retry={d.reload}>
                    {error && <div className="alert">{error}</div>}
                    <Table
                        data={list}
                        columns={resource.columns.map(
                            ([key, label, render]) => {
                                if (
                                    (key === "show" || key === "renew") &&
                                    [
                                        resources.plans,
                                        resources.knowledge,
                                        resources.notices,
                                        resources.coupons,
                                    ].includes(resource)
                                )
                                    return [
                                        key,
                                        label,
                                        (r: Row) => (
                                            <AdminSwitch
                                                label={`${r.name || r.title || r.id} ${label}`}
                                                checked={Number(r[key]) === 1}
                                                onChange={async (checked) => {
                                                    const path =
                                                        resource ===
                                                        resources.plans
                                                            ? "plan/update"
                                                            : resource ===
                                                                resources.knowledge
                                                              ? "knowledge/show"
                                                              : resource ===
                                                                  resources.notices
                                                                ? "notice/show"
                                                                : "coupon/show";
                                                    await request(
                                                        admin(path),
                                                        resource ===
                                                            resources.plans
                                                            ? {
                                                                  id: r.id,
                                                                  [key]: checked
                                                                      ? 1
                                                                      : 0,
                                                              }
                                                            : { id: r.id },
                                                    );
                                                    d.reload();
                                                }}
                                            />
                                        ),
                                    ] as [
                                        string,
                                        string,
                                        (r: Row) => ReactNode,
                                    ];
                                return [key, label, render] as [
                                    string,
                                    string,
                                    ((r: Row) => ReactNode)?,
                                ];
                            },
                        )}
                        onReorder={
                            resource.sort && resource.sortKind && !search
                                ? async (items) => {
                                      try {
                                          await request(
                                              resource.sort!,
                                              sortPayload(
                                                  resource.sortKind!,
                                                  items,
                                              ),
                                          );
                                          d.reload();
                                      } catch (e) {
                                          setError((e as Error).message);
                                      }
                                  }
                                : undefined
                        }
                        sort={tableSort}
                        onSort={onTableSort}
                        actions={
                            resource.save ||
                            resource.drop ||
                            resource.actions ||
                            extraActions
                                ? (r, context) => (
                                      <>
                                          {resource.save &&
                                              resource.create !== true && (
                                                  <button
                                                      onClick={async () => {
                                                          const item = { ...r };
                                                          if (
                                                              resource ===
                                                              resources.users
                                                          ) {
                                                              try {
                                                                  Object.assign(
                                                                      item,
                                                                      (
                                                                          await request(
                                                                              query(
                                                                                  admin(
                                                                                      "user/getUserInfoById",
                                                                                  ),
                                                                                  {
                                                                                      id: r.id,
                                                                                  },
                                                                              ),
                                                                          )
                                                                      ).data,
                                                                  );
                                                                  item.invite_user_email =
                                                                      item
                                                                          .invite_user
                                                                          ?.email ||
                                                                      "";
                                                              } catch (e) {
                                                                  setError(
                                                                      (
                                                                          e as Error
                                                                      ).message,
                                                                  );
                                                                  return;
                                                              }
                                                          }
                                                          if (
                                                              resource.title ===
                                                              "知识库管理"
                                                          ) {
                                                              try {
                                                                  Object.assign(
                                                                      item,
                                                                      (
                                                                          await request(
                                                                              query(
                                                                                  resource.fetch,
                                                                                  {
                                                                                      id: r.id,
                                                                                  },
                                                                              ),
                                                                          )
                                                                      ).data,
                                                                  );
                                                              } catch (e) {
                                                                  setError(
                                                                      (
                                                                          e as Error
                                                                      ).message,
                                                                  );
                                                                  return;
                                                              }
                                                          }
                                                          for (const field of resource.fields) {
                                                              if (
                                                                  field.type ===
                                                                      "datetime-local" &&
                                                                  item[
                                                                      field.key
                                                                  ]
                                                              )
                                                                  item[
                                                                      field.key
                                                                  ] = new Date(
                                                                      item[
                                                                          field
                                                                              .key
                                                                      ] *
                                                                          1000 -
                                                                          new Date().getTimezoneOffset() *
                                                                              60000,
                                                                  )
                                                                      .toISOString()
                                                                      .slice(
                                                                          0,
                                                                          16,
                                                                      );
                                                          }
                                                          if (
                                                              resource.title ===
                                                              "用户管理"
                                                          ) {
                                                              item.transfer_enable =
                                                                  Number(
                                                                      item.transfer_enable,
                                                                  ) /
                                                                  1073741824;
                                                              item.u =
                                                                  Number(
                                                                      item.u ||
                                                                          0,
                                                                  ) /
                                                                  1073741824;
                                                              item.d =
                                                                  Number(
                                                                      item.d ||
                                                                          0,
                                                                  ) /
                                                                  1073741824;
                                                              delete item.password;
                                                          }
                                                          setEditing(item);
                                                      }}
                                                  >
                                                      编辑
                                                  </button>
                                              )}
                                          {resource.actions?.map(
                                              ([label, path, extra]) => (
                                                  <button
                                                      key={label}
                                                      disabled={
                                                          resource ===
                                                              resources.orders &&
                                                          r.status !== 0
                                                      }
                                                      onClick={() =>
                                                          action(path, r, extra)
                                                      }
                                                  >
                                                      {label}
                                                  </button>
                                              ),
                                          )}
                                          {resource.drop && (
                                              <button
                                                  className="danger"
                                                  onClick={() =>
                                                      action(resource.drop!, r)
                                                  }
                                              >
                                                  删除
                                              </button>
                                          )}
                                          {extraActions?.(r, context)}
                                      </>
                                  )
                                : undefined
                        }
                    />
                    {d.total > 0 && (
                        <Pager
                            page={page}
                            total={d.total}
                            size={pageSize}
                            onChange={setPage}
                        />
                    )}
                </State>
            </Panel>
            {editing && (
                <Modal
                    variant={
                        [
                            resources.plans,
                            resources.users,
                            resources.knowledge,
                            resources.notices,
                        ].includes(resource)
                            ? "drawer"
                            : "modal"
                    }
                    wide={
                        resource === resources.knowledge ||
                        resource === resources.notices
                    }
                    title={
                        editing[key]
                            ? `编辑 · ${resource.title}`
                            : `新建 · ${resource.title}`
                    }
                    close={() => setEditing(null)}
                >
                    <State
                        loading={groups.loading || plans.loading}
                        error={groups.error || plans.error}
                        retry={() => {
                            groups.reload();
                            plans.reload();
                        }}
                    >
                        {resource === resources.notices ? (
                            <ContentComposer
                                kind="notice"
                                initial={editing}
                                onSave={async (body) => {
                                    await request(resource.save!, body);
                                    d.reload();
                                    setEditing(null);
                                }}
                            />
                        ) : (
                            <Editor
                                fields={formPresentation(
                                    editorFields.filter(
                                        (field) =>
                                            field.key !== "force_update" ||
                                            Boolean(editing.id),
                                    ),
                                    Object.keys(resources).find(
                                        (k) => resources[k] === resource,
                                    ) || "",
                                )}
                                initial={editing}
                                resolveFields={(fields, values) =>
                                    resourceFields(
                                        Object.keys(resources).find(
                                            (k) => resources[k] === resource,
                                        ) || "",
                                        fields,
                                        values,
                                    )
                                }
                                linkValues={(key, next, values) =>
                                    linkResource(
                                        Object.keys(resources).find(
                                            (key) =>
                                                resources[key] === resource,
                                        ) || "",
                                        rows(plans.data),
                                        key,
                                        next,
                                        values,
                                    )
                                }
                                validate={validateResource}
                                onSave={async (body) => {
                                    const clean: Row = {};
                                    resource.fields.forEach((field) => {
                                        if (
                                            body[field.key] !== undefined &&
                                            !(
                                                field.key === "password" &&
                                                !body.password
                                            )
                                        )
                                            clean[field.key] = body[field.key];
                                    });
                                    if (editing[key]) clean[key] = editing[key];
                                    if (resource.title === "用户管理")
                                        ["transfer_enable", "u", "d"].forEach(
                                            (field) => {
                                                if (clean[field] != null)
                                                    clean[field] = Math.round(
                                                        Number(clean[field]) *
                                                            1073741824,
                                                    );
                                            },
                                        );
                                    if (resource.defaults)
                                        Object.entries(
                                            resource.defaults,
                                        ).forEach(([k, v]) => {
                                            if (!(k in clean)) clean[k] = v;
                                        });
                                    if (
                                        ["coupons", "giftcards"].some(
                                            (k) => resources[k] === resource,
                                        ) &&
                                        (editing[key] ||
                                            Number(clean.generate_count) <= 1)
                                    )
                                        delete clean.generate_count;
                                    if (
                                        (resource === resources.coupons ||
                                            resource === resources.giftcards) &&
                                        !editing[key] &&
                                        Number(clean.generate_count) > 1
                                    )
                                        await download(
                                            resource.save!,
                                            clean,
                                            resource === resources.coupons
                                                ? "coupons.csv"
                                                : "giftcards.csv",
                                        );
                                    else await request(resource.save!, clean);
                                    setEditing(null);
                                    d.reload();
                                }}
                            />
                        )}
                    </State>
                </Modal>
            )}
        </>
    );
}
const labels: Record<string, string> = {
    schedule: "定时任务",
    horizon: "队列消费者",
    schedule_last_runtime: "最近任务运行",
    failedJobs: "近期失败任务",
    jobsPerMinute: "每分钟任务数",
    pausedMasters: "暂停的主进程",
    processes: "进程数",
    recentJobs: "近期任务",
    status: "运行状态",
    queueWithMaxRuntime: "最长耗时队列",
    queueWithMaxThroughput: "最高吞吐队列",
    wait: "等待时间",
    periods: "统计时间范围",
    online_user: "在线用户",
    month_income: "本月收入",
    last_month_income: "上月收入",
    day_income: "今日收入",
    month_register_total: "本月注册用户",
    day_register_total: "今日注册用户",
    ticket_pending_total: "待处理工单",
    commission_pending_total: "待结算佣金订单",
    commission_month_payout: "本月佣金支出",
    commission_last_month_payout: "上月佣金支出",
    app_name: "站点名称",
    app_description: "站点介绍",
    app_url: "站点 URL",
    logo: "Logo URL",
    custom_footer_html: "自定义页脚 HTML",
    currency: "货币代码",
    currency_symbol: "货币符号",
    stop_register: "关闭注册",
    force_https: "强制 HTTPS",
    subscribe_url: "订阅域名",
    subscribe_path: "自定义订阅路径",
    try_out_plan_id: "试用套餐 ID",
    try_out_enable: "启用试用",
    invite_never_expire: "邀请码永不过期",
    commission_first_time_enable: "仅首单计算佣金",
    commission_auto_check_enable: "自动审核佣金",
    commission_distribution_enable: "启用多级佣金",
    commission_distribution_l1: "一级佣金比例（%）",
    commission_distribution_l2: "二级佣金比例（%）",
    commission_distribution_l3: "三级佣金比例（%）",
    withdraw_close_enable: "关闭提现",
    email_whitelist_enable: "启用邮箱白名单",
    email_whitelist_suffix: "允许注册的邮箱域名",
    email_gmail_limit_enable: "限制 Gmail 别名注册",
    register_limit_by_ip_enable: "限制单个 IP 注册",
    register_limit_count: "注册次数上限",
    register_limit_expire: "注册限制有效期（分钟）",
    password_limit_enable: "限制密码错误次数",
    password_limit_count: "密码错误次数上限",
    password_limit_expire: "密码限制有效期（分钟）",
    new_order_event_id: "新购套餐后的流量处理",
    renew_order_event_id: "续费后的流量处理",
    change_order_event_id: "切换套餐后的流量处理",
    try_out_hour: "试用时长（小时）",
    tos_url: "服务条款 URL",
    server_token: "节点通讯密钥",
    server_api_url: "节点 API URL",
    server_pull_interval: "节点拉取间隔",
    server_push_interval: "节点推送间隔",
    device_limit_mode: "设备限制模式",
    server_node_report_min_traffic: "节点上报最低流量",
    server_device_online_min_traffic: "设备在线最低流量",
    email_verify: "注册邮箱验证",
    safe_mode_enable: "安全模式",
    secure_path: "后台入口路径",
    recaptcha_enable: "启用 reCAPTCHA",
    recaptcha_key: "reCAPTCHA 密钥",
    recaptcha_site_key: "reCAPTCHA 站点密钥",
    invite_force: "注册必须通过邮件邀请",
    invite_commission: "邀请佣金比例",
    invite_gen_limit: "待接受邮件邀请数量限制",
    commission_withdraw_limit: "最低提现金额",
    commission_withdraw_method: "提现方式",
    email_host: "SMTP 主机",
    email_port: "SMTP 端口",
    email_username: "SMTP 用户名",
    apple_account_url: "AppleAuto 接口地址（HTTPS 域名）",
    apple_account_enable: "启用 iOS 下载账号",
    apple_account_token: "AppleAuto API Key（留空保留，仅服务端保存）",
    apple_account_share: "AppleAuto 分享代码",
    email_password: "SMTP 密码",
    email_encryption: "SMTP 加密方式",
    email_from_address: "发件人地址",
    telegram_bot_enable: "启用 Telegram 机器人",
    telegram_bot_token: "机器人 Token",
    telegram_discuss_link: "Telegram 群链接",
    ticket_status: "工单开放模式",
    deposit_bounus: "充值奖励阶梯",
    plan_change_enable: "允许切换套餐",
    surplus_enable: "折抵剩余价值",
    reset_traffic_method: "流量重置模式",
    allow_new_period: "允许新周期",
    show_subscribe_method: "订阅链接生效模式",
    show_subscribe_expire: "限时链接有效时间（分钟）",
    show_info_to_server_enable: "在订阅中展示订阅信息",
    paid_total: "总收入",
    order_count: "订单数",
    user_count: "用户数",
    paid_count: "已付订单数",
};
const groupNames: Record<string, string> = {
    site: "站点设置",
    footer: "页脚 HTML",
    safe: "安全与注册",
    subscribe: "订阅设置",
    server: "节点通讯",
    invite: "邀请与佣金",
    email: "邮件发送",
    telegram: "Telegram",
    ticket: "工单设置",
    deposit: "充值奖励",
    app: "客户端下载",
};
export function Settings() {
    const d = useData(admin("config/fetch"));
    const schema = useData(admin("console/configSchema"));
    const plans = useData<Row[]>(admin("plan/fetch"));
    const creditGroups = useData<Row[]>(admin("server/group/fetch"));
    const [group, setGroup] = useState("site"),
        [saved, setSaved] = useState("");
    const [dirty, setDirty] = useState(false),
        [actionBusy, setActionBusy] = useState(false),
        [actionResult, setActionResult] = useState("");
    async function runAction(endpoint: string) {
        setActionBusy(true);
        setActionResult("");
        try {
            const response = await request(admin(endpoint), {});
            const log = (
                response as typeof response & { log?: { error?: string } }
            ).log;
            if (log?.error) throw new Error(log.error);
            setActionResult("操作成功");
        } catch (e) {
            setActionResult((e as Error).message);
        } finally {
            setActionBusy(false);
        }
    }
    const raw = d.data?.[group] || {};
    const fields = settingsPresentation(
        group,
        Object.entries(raw)
            .filter(
                ([k]) =>
                    !k.startsWith("frontend_") &&
                    k !== "email_template" &&
                    k !== "invite_never_expire",
            )
            .map(([k, v]) =>
                k === "credit_base_group_id"
                    ? { key: k, label: "额度基础权限组", type: "select" as const, options: [["", "未配置（沿用原权限）"] as [string, string], ...rows(creditGroups.data).map((r) => [String(r.id), r.name] as [string, string])] }
                    : k === "try_out_plan_id"
                    ? {
                          key: k,
                          label: "试用套餐",
                          type: "select" as const,
                          options: [
                              ["0", "不指定套餐"] as [string, string],
                              ...rows(plans.data).map(
                                  (r) =>
                                      [String(r.id), r.name] as [
                                          string,
                                          string,
                                      ],
                              ),
                          ],
                      }
                    : configField(k, v, schema.data?.[k], labels[k] || k),
            ),
    );
    return (
        <Panel title="系统配置" className="settings-panel">
            <div className="section-tabs">
                {Object.keys(groupNames).map((k) => (
                    <button
                        key={k}
                        className={group === k ? "selected" : ""}
                        onClick={() => {
                            setGroup(k);
                            setSaved("");
                            setDirty(false);
                            setActionResult("");
                        }}
                    >
                        {groupNames[k]}
                    </button>
                ))}
            </div>
            <State
                loading={d.loading || schema.loading || plans.loading || creditGroups.loading}
                error={d.error || schema.error || plans.error || creditGroups.error}
                retry={() => {
                    d.reload();
                    schema.reload();
                    plans.reload();
                    creditGroups.reload();
                }}
            >
                <Editor
                    key={group + JSON.stringify(raw)}
                    fields={fields}
                    initial={raw}
                    resolveFields={settingsFields}
                    linkValues={linkSettings}
                    onDirty={() => {
                        setSaved("");
                        setDirty(true);
                        setActionResult("");
                    }}
                    validate={validateSettings}
                    onSave={async (body) => {
                        const changes = changedSettings(body, raw);
                        if (Object.keys(changes).length)
                            await request(admin("config/save"), changes);
                        setSaved("设置已保存");
                        setDirty(false);
                        d.reload();
                    }}
                />
                {group === "subscribe" && <p className="pad muted">设置额度基础权限组后：订阅有效时，额度沿用订阅权限；订阅到期或无订阅时，额度仅可使用基础组节点。适用于所有额度用户（含已迁移的一次性套餐）。额度余额、套餐记录及限速、设备限制不变。节点在下次拉取用户时更新权限，客户端需更新订阅以刷新节点列表。</p>}
                {group === "app" && <div className="pad"><p className="muted">填写 AppleAuto 的 HTTPS 接口域名及分享链接最后一段代码。接口地址不包含 /share 或 /client 路径。仅有效订阅或有剩余额度的用户可查看。请先保存，再测试连接；启用后刷新用户页面。</p><button disabled={dirty || actionBusy} onClick={() => runAction("config/testAppleAccount")}>测试下载账号连接</button></div>}
                {group === "email" && (
                    <div className="pad">
                        <p className="muted">
                            测试邮件发往当前管理员邮箱，使用已保存的 SMTP
                            配置。修改邮件配置后需重启队列服务。
                        </p>
                        <button
                            disabled={
                                dirty ||
                                actionBusy ||
                                !raw.email_host ||
                                !raw.email_from_address
                            }
                            onClick={() => runAction("config/testSendMail")}
                        >
                            发送测试邮件
                        </button>
                        <AdminMailPreview />
                    </div>
                )}
                {group === "telegram" && (
                    <div className="pad">
                        <p className="muted">
                            使用已保存的机器人 Token 在 Telegram 注册本站
                            Webhook；站点需有可访问的 HTTPS 地址。
                        </p>
                        <button
                            disabled={
                                dirty || actionBusy || !raw.telegram_bot_token
                            }
                            onClick={() =>
                                runAction("config/setTelegramWebhook")
                            }
                        >
                            设置 Telegram Webhook
                        </button>
                    </div>
                )}
                {dirty && ["email", "telegram"].includes(group) && (
                    <p className="pad muted">
                        请先保存配置，再执行测试或连接操作。
                    </p>
                )}
                {actionResult && (
                    <p className="pad" role="status">
                        {actionResult}
                    </p>
                )}
                {saved && (
                    <p className="success-message" role="status">
                        {saved}
                    </p>
                )}
            </State>
        </Panel>
    );
}
export function RiskSettings() {
    const d = useData(ops("risk/settings/fetch"));
    return (
        <Panel title="风控全局设置">
            <State {...d} retry={d.reload}>
                <Editor
                    fields={[
                        { key: "connection_log_interval", label: "连接日志采样间隔", type: "number", required: true, min: 60, max: 86400, step: 1, unit: "秒", hint: "建议 3600 秒。间隔越短，日志写入量越大；不影响登录与订阅规则的统计窗口。" },
                        { key: "connection_log_retention_days", label: "连接日志保留时间", type: "number", required: true, min: 1, max: 365, step: 1, unit: "天", hint: "建议 30 天。清理任务运行时删除超过保留期的连接日志。" },
                    ]}
                    initial={d.data || {}}
                    onSave={async (b) => {
                        await request(ops("risk/settings/update"), b);
                        d.reload();
                    }}
                />
            </State>
        </Panel>
    );
}
export function Translations() {
    const plans = useData<Row[]>(admin("plan/fetch")),
        locales = useData<string[]>(admin("ops/i18n/plan/locales"));
    const [plan, setPlan] = useState(""),
        [locale, setLocale] = useState("zh-CN"),
        [saved, setSaved] = useState("");
    const d = useData(
        plan
            ? query(admin("ops/i18n/plan/fetch"), { plan_id: plan })
            : admin("plan/fetch"),
    );
    return (
        <Panel title="套餐多语言">
            <div className="pad actions">
                <select
                    value={plan}
                    onChange={(e) => {
                        setPlan(e.target.value);
                        setSaved("");
                    }}
                    aria-label="选择套餐"
                >
                    <option value="">选择套餐</option>
                    {plans.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </select>
                <select
                    value={locale}
                    onChange={(e) => {
                        setLocale(e.target.value);
                        setSaved("");
                    }}
                    aria-label="选择语言"
                >
                    {locales.data?.map((l) => (
                        <option key={l}>{l}</option>
                    ))}
                </select>
            </div>
            {plan ? (
                <State {...d}>
                    <AdminPlanAutoTranslation
                        key={plan}
                        plan={plan}
                        locales={locales.data || []}
                        onSaved={d.reload}
                    />
                    <div className="pad muted">
                        默认名称：{d.data?.default?.name}
                        <details>
                            <summary>查看套餐原文</summary>
                            <PlanDescription
                                content={d.data?.default?.content}
                            />
                        </details>
                    </div>
                    <Editor
                        key={plan + locale + JSON.stringify(d.data)}
                        fields={[
                            f("name", "翻译名称"),
                            f("content", "翻译说明（JSON / HTML）", "textarea"),
                        ]}
                        initial={{
                            plan_id: Number(plan),
                            locale,
                            ...d.data?.translations?.[locale],
                        }}
                        onSave={async (b) => {
                            await request(admin("ops/i18n/plan/save"), b);
                            setSaved("翻译已保存");
                            d.reload();
                        }}
                    />
                    {saved && <p className="success-message">{saved}</p>}
                </State>
            ) : (
                <Empty text="选择套餐后开始翻译" />
            )}
        </Panel>
    );
}
export function GenerateUsers({ onCreated }: { onCreated?: () => void }) {
    const plans = useData<Row[]>(admin("plan/fetch"));
    const [notice, setNotice] = useState("");
    return (
        <Panel title="生成用户">
            <p className="pad muted">
                填写邮箱前缀时创建一个用户；留空时批量生成并下载账号
                CSV。密码留空时使用完整邮箱作为初始密码。
            </p>
            <State {...plans} retry={plans.reload}>
                <Editor
                    fields={[
                        f("email_prefix", "邮箱前缀（单个用户）"),
                        f("email_suffix", "邮箱域名", "text", true),
                        {
                            ...f(
                                "generate_count",
                                "生成数量（1–500）",
                                "number",
                            ),
                            min: 1,
                            max: 500,
                            step: 1,
                        },
                        f("password", "初始密码", "password"),
                        {
                            ...f("plan_id", "套餐", "select"),
                            nullable: true,
                            options: (plans.data || []).map((p) => [
                                String(p.id),
                                p.name,
                            ]),
                        },
                        f("expired_at", "到期时间", "datetime-local"),
                    ]}
                    initial={{ generate_count: 1 }}
                    validate={(b) =>
                        !b.email_prefix &&
                        (!Number.isInteger(Number(b.generate_count)) ||
                            Number(b.generate_count) < 1 ||
                            Number(b.generate_count) > 500)
                            ? "生成数量必须为 1–500 的整数"
                            : undefined
                    }
                    onSave={async (b) => {
                        if (b.email_prefix)
                            await request(admin("user/generate"), b);
                        else
                            await download(
                                admin("user/generate"),
                                b,
                                "generated-users.csv",
                            );
                        setNotice(
                            b.email_prefix
                                ? "用户已生成"
                                : "用户已生成，账号 CSV 已下载",
                        );
                        onCreated?.();
                    }}
                />
                {notice && (
                    <p className="pad" role="status">
                        {notice}
                    </p>
                )}
            </State>
        </Panel>
    );
}
export function Payments() {
    const d = useData<Row[]>(admin("payment/fetch")),
        methods = useData<string[]>(admin("payment/getPaymentMethods"));
    const [editing, setEditing] = useState<Row | null>(null);
    return (
        <>
            <Panel
                title="支付配置"
                actions={
                    <>
                        {" "}
                        <Reload onClick={d.reload} />
                        <SortButton
                            path={admin("payment/sort")}
                            kind="payments"
                            items={d.data || []}
                            onSaved={d.reload}
                        />
                        <button
                            className="primary"
                            disabled={
                                methods.loading ||
                                Boolean(methods.error) ||
                                !methods.data?.length
                            }
                            onClick={() => setEditing({})}
                        >
                            添加支付方式
                        </button>
                    </>
                }
            >
                <State
                    loading={d.loading || methods.loading}
                    error={d.error || methods.error}
                    retry={() => {
                        d.reload();
                        methods.reload();
                    }}
                >
                    <Table
                        data={d.data || []}
                        columns={[
                            ["id", "ID"],
                            [
                                "enable",
                                "启用",
                                (r) => (
                                    <AdminSwitch
                                        label={`${r.name} 启用`}
                                        checked={Number(r.enable) === 1}
                                        onChange={async (checked) => {
                                            await request(
                                                admin("payment/update"),
                                                {
                                                    id: r.id,
                                                    enable: checked ? 1 : 0,
                                                },
                                            );
                                            d.reload();
                                        }}
                                    />
                                ),
                            ],
                            ["name", "显示名称"],
                            ["payment", "支付接口"],
                            ["notify_url", "通知地址"],
                        ]}
                        onReorder={async (items) => {
                            await request(
                                admin("payment/sort"),
                                sortPayload("payments", items),
                            );
                            d.reload();
                        }}
                        actions={(r) => (
                            <>
                                <button onClick={() => setEditing(r)}>
                                    编辑
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            await request(
                                                admin("payment/show"),
                                                { id: r.id },
                                            );
                                            d.reload();
                                        } catch (e) {
                                            alert((e as Error).message);
                                        }
                                    }}
                                >
                                    切换启用
                                </button>
                                <button
                                    className="danger"
                                    onClick={async () => {
                                        if (confirm("确认删除支付方式？")) {
                                            try {
                                                await request(
                                                    admin("payment/drop"),
                                                    { id: r.id },
                                                );
                                                d.reload();
                                            } catch (e) {
                                                alert((e as Error).message);
                                            }
                                        }
                                    }}
                                >
                                    删除
                                </button>
                            </>
                        )}
                    />
                </State>
            </Panel>
            {editing && (
                <Modal
                    variant="modal"
                    title="支付方式设置"
                    close={() => setEditing(null)}
                >
                    <PaymentEditor
                        initial={editing}
                        methods={methods.data || []}
                        onSave={async (b) => {
                            await request(admin("payment/save"), b);
                            setEditing(null);
                            d.reload();
                        }}
                    />
                </Modal>
            )}
        </>
    );
}
function PaymentEditor({
    initial,
    methods,
    onSave,
}: {
    initial: Row;
    methods: string[];
    onSave: (b: Row) => Promise<void>;
}) {
    const [method, setMethod] = useState(initial.payment || methods[0] || "");
    const [commonDraft, setCommonDraft] = useState(initial);
    const d = useData(method ? admin("payment/getPaymentForm") : "", {
        payment: method,
        id: method === initial.payment ? initial.id : undefined,
    });
    return (
        <>
            <div className="pad">
                <label>
                    支付网关
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                    >
                        {methods.map((m) => (
                            <option key={m}>{m}</option>
                        ))}
                    </select>
                </label>
            </div>
            <State {...d} retry={d.reload}>
                {Object.entries(d.data || {})
                    .filter(([, v]) => v.type === "alert")
                    .map(([key, v]) => (
                        <div className="pad muted" key={key}>
                            <Html value={v.content} />
                        </div>
                    ))}
                <Editor
                    key={method}
                    fields={[
                        f("name", "显示名称", "text", true),
                        f("icon", "图标 URL"),
                        f("notify_domain", "通知域名", "url"),
                        {
                            ...f(
                                "handling_fee_fixed",
                                "固定手续费（元）",
                                "number",
                            ),
                            min: 0,
                            step: 0.01,
                            scale: 100,
                        },
                        {
                            ...f(
                                "handling_fee_percent",
                                "手续费比例 (%)",
                                "number",
                            ),
                            min: 0,
                            max: 100,
                        },
                        ...paymentFields(d.data || {}),
                    ]}
                    initial={paymentInitial(
                        { ...initial, ...commonDraft },
                        d.data || {},
                        method === initial.payment,
                    )}
                    onValuesChange={(values) =>
                        setCommonDraft(
                            Object.fromEntries(
                                [
                                    "name",
                                    "icon",
                                    "notify_domain",
                                    "handling_fee_fixed",
                                    "handling_fee_percent",
                                ].map((key) => [
                                    key,
                                    key === "handling_fee_fixed" &&
                                    values[key] != null
                                        ? Math.round(Number(values[key]) * 100)
                                        : values[key],
                                ]),
                            ),
                        )
                    }
                    onSave={async (b) => {
                        await onSave(
                            paymentPayload(b, d.data || {}, method, initial),
                        );
                    }}
                />
            </State>
        </>
    );
}
const nodeTypes = [
    "v2node",
    "vmess",
    "vless",
    "trojan",
    "shadowsocks",
    "hysteria",
    "tuic",
    "anytls",
];
export function Nodes() {
    const groups = useData<Row[]>(admin("server/group/fetch"));
    const routes = useData<Row[]>(admin("server/route/fetch"));
    const d = useData<Row[]>(admin("server/manage/getNodes"));
    const [type, setType] = useState("v2node"),
        [editing, setEditing] = useState<Row | null>(null);
    const [error, setError] = useState("");
    const [command, setCommand] = useState<Row | null>(null);
    const schema = useData<Row>(query(admin("console/nodeSchema"), { type }));
    return (
        <>
            <Panel
                title="节点管理"
                actions={
                    <>
                        <Reload onClick={d.reload} />
                        <SortButton
                            path={admin("server/manage/sort")}
                            kind="nodes"
                            items={rows(d.data)}
                            onSaved={d.reload}
                        />
                        <button
                            className="primary"
                            onClick={() =>
                                setEditing({
                                    type,
                                    group_id: [],
                                    route_id: [],
                                    rate: 1,
                                    tls: 0,
                                    network: "tcp",
                                    disable_sni: 0,
                                    zero_rtt_handshake: 0,
                                })
                            }
                        >
                            添加节点
                        </button>
                    </>
                }
            >
                <State {...d}>
                    {error && <div className="alert">{error}</div>}
                    <Table
                        data={rows(d.data)}
                        columns={[
                            ["id", "ID"],
                            name,
                            ["type", "类型"],
                            ["host", "主机"],
                            ["port", "端口"],
                            ["rate", "倍率"],
                            [
                                "show",
                                "显隐",
                                (r) => (
                                    <AdminSwitch
                                        label={`${r.name} 显示`}
                                        checked={Number(r.show) === 1}
                                        onChange={async (checked) => {
                                            await request(
                                                admin(
                                                    `server/${r.type}/update`,
                                                ),
                                                {
                                                    id: r.id,
                                                    show: checked ? 1 : 0,
                                                },
                                            );
                                            d.reload();
                                        }}
                                    />
                                ),
                            ],
                            [
                                "group_id",
                                "权限组",
                                (r) =>
                                    (r.group_id || [])
                                        .map(
                                            (id: number) =>
                                                rows(groups.data).find(
                                                    (g) => g.id === id,
                                                )?.name || id,
                                        )
                                        .join(" / "),
                            ],
                            ["online", "在线用户"],
                            [
                                "available_status",
                                "状态",
                                (r) =>
                                    ["离线", "未上报流量", "正常"][
                                        r.available_status
                                    ],
                            ],
                        ]}
                        onReorder={async (items) => {
                            try {
                                await request(
                                    admin("server/manage/sort"),
                                    sortPayload("nodes", items),
                                );
                                d.reload();
                            } catch (e) {
                                setError((e as Error).message);
                            }
                        }}
                        actions={(r) => (
                            <>
                                {r.install_command && (
                                    <button onClick={() => setCommand(r)}>
                                        安装命令
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        setType(r.type);
                                        setEditing(r);
                                    }}
                                >
                                    编辑
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            await request(
                                                admin(`server/${r.type}/copy`),
                                                { id: r.id },
                                            );
                                            d.reload();
                                        } catch (e) {
                                            setError((e as Error).message);
                                        }
                                    }}
                                >
                                    复制
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            await request(
                                                admin(
                                                    `server/${r.type}/update`,
                                                ),
                                                {
                                                    id: r.id,
                                                    show: r.show ? 0 : 1,
                                                },
                                            );
                                            d.reload();
                                        } catch (e) {
                                            setError((e as Error).message);
                                        }
                                    }}
                                >
                                    切换展示
                                </button>
                                <button
                                    className="danger"
                                    onClick={async () => {
                                        if (confirm("确认删除节点？")) {
                                            try {
                                                await request(
                                                    admin(
                                                        `server/${r.type}/drop`,
                                                    ),
                                                    { id: r.id },
                                                );
                                                d.reload();
                                            } catch (e) {
                                                setError((e as Error).message);
                                            }
                                        }
                                    }}
                                >
                                    删除
                                </button>
                            </>
                        )}
                    />
                </State>
            </Panel>
            {command && (
                <Modal title="节点安装命令" close={() => setCommand(null)}>
                    <div className="pad">
                        <p className="muted">
                            命令包含节点通讯凭据，仅在目标服务器使用。
                        </p>
                        <textarea
                            readOnly
                            aria-label="节点安装命令"
                            value={command.install_command}
                        />
                        <button
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        command.install_command,
                                    );
                                    setCommand({ ...command, copied: true });
                                } catch (e) {
                                    setCommand({
                                        ...command,
                                        error: (e as Error).message,
                                    });
                                }
                            }}
                        >
                            复制命令
                        </button>
                        {command.copied && <p role="status">已复制</p>}
                        {command.error && (
                            <p className="alert">{command.error}</p>
                        )}
                    </div>
                </Modal>
            )}
            {editing && (
                <Modal title="节点配置" close={() => setEditing(null)}>
                    {!editing.id && (
                        <div className="pad">
                            <label>
                                节点类型
                                <select
                                    value={type}
                                    onChange={(e) => setType(e.target.value)}
                                >
                                    {nodeTypes.map((t) => (
                                        <option key={t}>{t}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    )}
                    <State
                        loading={
                            schema.loading || groups.loading || routes.loading
                        }
                        error={schema.error || groups.error || routes.error}
                        retry={() => {
                            schema.reload();
                            groups.reload();
                            routes.reload();
                        }}
                    >
                        <Editor
                            key={type}
                            resolveFields={(fields, values) =>
                                formPresentation(
                                    nodeFields(
                                        type,
                                        fields.map((field) =>
                                            field.key === "parent_id"
                                                ? {
                                                      ...field,
                                                      label: "父节点",
                                                      type: "select",
                                                      nullable: true,
                                                      options: [
                                                          ["", "不设置父节点"],
                                                          ...rows(d.data)
                                                              .filter(
                                                                  (r) =>
                                                                      r.type ===
                                                                          type &&
                                                                      String(
                                                                          r.id,
                                                                      ) !==
                                                                          String(
                                                                              editing.id,
                                                                          ) &&
                                                                      (type !==
                                                                          "v2node" ||
                                                                          r.protocol ===
                                                                              values.protocol),
                                                              )
                                                              .map(
                                                                  (r) =>
                                                                      [
                                                                          String(
                                                                              r.id,
                                                                          ),
                                                                          r.name,
                                                                      ] as [
                                                                          string,
                                                                          string,
                                                                      ],
                                                              ),
                                                      ] as [string, string][],
                                                      hint: "可选择同类型、同协议的节点。切换协议时会清除当前选择。",
                                                  }
                                                : field,
                                        ),
                                        values,
                                    ),
                                    "nodes",
                                )
                            }
                            linkValues={linkNode}
                            fields={nodeSettingsFields(
                                Object.entries(schema.data || {})
                                    .filter(
                                        ([k]) => !k.includes(".") && k !== "id",
                                    )
                                    .map(([k, rule]) => {
                                        if (
                                            k === "group_id" ||
                                            k === "route_id"
                                        )
                                            return {
                                                key: k,
                                                label: nodeLabels[k] || k,
                                                type: "multiselect",
                                                required: k === "group_id",
                                                options: rows(
                                                    k === "group_id"
                                                        ? groups.data
                                                        : routes.data,
                                                ).map((r) => [
                                                    String(r.id),
                                                    r.name ||
                                                        r.remarks ||
                                                        String(r.id),
                                                ]),
                                            } as Field;
                                        const str = Array.isArray(rule)
                                            ? rule.join("|")
                                            : String(rule);
                                        if (k === "flow")
                                            return {
                                                key: k,
                                                label: "VLESS Flow",
                                                type: "select",
                                                nullable: true,
                                                options: [
                                                    ["", "不设置"],
                                                    [
                                                        "xtls-rprx-vision",
                                                        "XTLS Vision",
                                                    ],
                                                ],
                                            } as Field;
                                        const enumRule =
                                            str.match(/(?:^|\|)in:([^|]+)/);
                                        if (enumRule)
                                            return {
                                                key: k,
                                                label: nodeLabels[k] || k,
                                                type:
                                                    enumRule[1] === "0,1" &&
                                                    [
                                                        "show",
                                                        "tls",
                                                        "allow_insecure",
                                                        "tls_allow_insecure",
                                                        "is_shield",
                                                        "insecure",
                                                    ].includes(k)
                                                        ? "switch"
                                                        : "select",
                                                required:
                                                    str.includes("required"),
                                                options: enumRule[1]
                                                    .split(",")
                                                    .map((v) => [v, v]),
                                            } as Field;
                                        return f(
                                            k,
                                            nodeLabels[k] || k,
                                            str.includes("array") ||
                                                k.endsWith("_settings")
                                                ? "json"
                                                : str.includes("integer") ||
                                                    str.includes("numeric")
                                                  ? "number"
                                                  : "text",
                                            str.includes("required"),
                                        );
                                    }),
                            )}
                            initial={nodeSettingsInitial(editing)}
                            onSave={async (b) => {
                                b = nodeSettingsPayload(b);
                                if (
                                    b.padding_scheme != null &&
                                    typeof b.padding_scheme !== "string"
                                )
                                    b.padding_scheme = JSON.stringify(
                                        b.padding_scheme,
                                    );
                                const clean: Row = {};
                                Object.keys(schema.data || {}).forEach((k) => {
                                    if (!k.includes(".") && b[k] !== undefined)
                                        clean[k] = b[k];
                                });
                                if (editing.id) clean.id = editing.id;
                                if (type === "v2node")
                                    clean.zero_rtt_handshake ??=
                                        editing.zero_rtt_handshake ?? 0;
                                await request(
                                    admin(`server/${type}/save`),
                                    clean,
                                );
                                setEditing(null);
                                d.reload();
                            }}
                        />
                    </State>
                </Modal>
            )}
        </>
    );
}
const nodeLabels: Record<string, string> = {
    listen_ip: "监听地址",
    disable_sni: "禁用 SNI",
    cipher: "加密算法",
    encryption: "VLESS 加密方式",
    encryption_settings: "VLESS 加密设置",
    zero_rtt_handshake: "启用 0-RTT 握手",
    congestion_control: "拥塞控制算法",
    udp_relay_mode: "UDP 中继模式",
    padding_scheme: "填充策略",
    version: "协议版本",
    server_name: "TLS 服务器名称（SNI）",
    insecure: "跳过证书校验",
    allow_insecure: "跳过证书校验",
    obfs_password: "混淆密码",
    networkSettings: "传输设置",
    tlsSettings: "TLS 设置",
    ruleSettings: "路由设置",
    dnsSettings: "DNS 设置",
    name: "节点名称",
    host: "连接主机",
    port: "连接端口",
    server_port: "服务端口",
    group_id: "权限组",
    route_id: "路由规则",
    rate: "流量倍率",
    tags: "标签数组",
    parent_id: "父节点 ID",
    protocol: "协议",
    network: "传输方式",
    network_settings: "传输设置",
    tls: "TLS 模式",
    tls_settings: "TLS 设置",
    reality_settings: "Reality 设置",
    security: "加密方式",
    obfs: "混淆方式",
    obfs_settings: "混淆设置",
    show: "展示",
    sort: "排序",
    up_mbps: "上传 Mbps",
    down_mbps: "下载 Mbps",
    trusted_x_forwarded_for: "信任的 X-Forwarded-For",
    udp: "启用 UDP",
};
export function System() {
    const status = useData(admin("system/getSystemStatus")),
        queue = useData(admin("system/getQueueStats"));
    return (
        <>
            <div className="split">
                {[
                    [status, "系统状态"],
                    [queue, "队列状态"],
                ].map(([d, title]) => {
                    const data = d as ReturnType<typeof useData>;
                    return (
                        <Panel
                            key={title as string}
                            title={title as string}
                            actions={<Reload onClick={data.reload} />}
                        >
                            <State {...data}>
                                <div className="stats-list">
                                    {Object.entries(data.data || {}).map(
                                        ([k, v]) => (
                                            <div key={k}>
                                                <span>{labels[k] || k}</span>
                                                <strong>
                                                    {k ===
                                                    "schedule_last_runtime"
                                                        ? date(v)
                                                        : typeof v === "boolean"
                                                          ? v
                                                              ? "运行中"
                                                              : "未运行"
                                                          : typeof v ===
                                                              "object"
                                                            ? JSON.stringify(v)
                                                            : String(v)}
                                                </strong>
                                            </div>
                                        ),
                                    )}
                                </div>
                            </State>
                        </Panel>
                    );
                })}
            </div>
            <QueueDetails />
        </>
    );
}
