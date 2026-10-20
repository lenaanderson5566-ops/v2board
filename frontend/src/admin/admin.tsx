import { AdminLogTimeZone, logTime } from "./admin-log-time";
import { AdminDisplaySettings } from "./AdminDisplaySettings";
import { languageCodes } from "../shared/language-options";
import { Plus, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PlanDescription } from "../shared/PlanDescription";
import {
    admin,
    bytes,
    date,
    download,
    money,
    ops,
    query,
    request,
    rows,
    type Row,
} from "../shared/api";
import { dateTimeInput } from "../shared/timezone";
import {
    Editor,
    Empty,
    Modal,
    Pager,
    Panel,
    Reload,
    State,
    Table,
    useData,
    type Field,
} from "../shared/ui";
import { SystemHealth } from "./AdminDiagnostics";
import { AdminLogFilters } from "./AdminLogFilters";
import { AdminPlanAutoTranslation } from "./AdminPlanAutoTranslation";
import { AdminRiskReview } from "./AdminRiskReview";
import { AdminUserActivityLink } from "./AdminUserActivity";
import { ClientUaStats } from "./ClientUaStats";
import { ContentComposer } from "./ContentComposer";
import { sortPayload } from "./admin-actions";
import { field, nameColumn, resetOptions } from "./admin-fields";
import {
    linkResource,
    resourceFields,
    validateResource,
} from "./admin-linkage";
import { formPresentation, adminLabels as labels } from "./admin-presentation";
import { AdminSwitch } from "./admin-switch";
import { QueueDetails, SortButton } from "./admin-tools";
import { adminUserLabel } from "./admin-user-label";
import { readListView, saveListView } from "./list-view-state";
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
    serverSearch?: boolean;
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
const price = (key: string, label: string): Field => ({
    ...field(key, label + "（CNY）", "number"),
    scale: 100,
    step: 0.01,
    hint:
        key === "onetime_price"
            ? "额度包价格；流量 (GB) 为额度数量。仅在用户的额度入口展示，可独立使用，套餐重置不会补回额度。"
            : "留空表示不提供该支付周期",
});
export const resources: Record<string, Resource> = {
    plans: {
        title: "套餐管理",
        fetch: admin("plan/fetch"),
        sort: admin("plan/sort"),
        sortKind: "plans",
        save: admin("plan/save"),
        drop: admin("plan/drop"),
        columns: [
            ["show", "销售状态"],
            nameColumn,
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
            field("name", "套餐名称", "text", true),
            field("group_id", "权限组 ID", "number", true),
            field("transfer_enable", "流量 (GB)", "number", true),
            field("device_limit", "设备数限制", "number"),
            field("speed_limit", "速率 (Mbps)", "number"),
            field("capacity_limit", "用户容量", "number"),
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
            field("content", "套餐说明 HTML", "textarea"),
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
        title: "节点权限组",
        fetch: admin("server/group/fetch"),
        save: admin("server/group/save"),
        drop: admin("server/group/drop"),
        columns: [
            ["id", "组ID"],
            ["name", "组名称"],
            ["user_count", "用户数量"],
            ["server_count", "节点数量"],
        ],
        fields: [field("name", "权限组名称", "text", true)],
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
                "backend",
                "适用内核",
                (r) =>
                    r.backend === "v2box"
                        ? "V2Box / sing-box"
                        : "V2Node / Xray",
            ],
            [
                "match",
                "规则数量",
                (r) =>
                    r.action === "sing_box"
                        ? (r.sing_box?.route?.rules?.length || 0) +
                          (r.sing_box?.dns?.rules?.length || 0)
                        : Array.isArray(r.match)
                          ? r.match.length
                          : 0,
            ],
            [
                "action",
                "格式 / 动作",
                (r) =>
                    r.action === "sing_box"
                        ? "sing-box 原生"
                        : `${r.backend === "v2box" ? "兼容格式 / " : ""}${r.action}`,
            ],
        ],
        fields: [
            field("remarks", "备注", "text", true),
            {
                key: "backend",
                label: "适用内核",
                type: "select",
                options: [
                    ["v2node", "V2Node / Xray"],
                    ["v2box", "V2Box / sing-box"],
                ],
            },
            field("match", "匹配条件", "json", true),
            {
                key: "action",
                label: "动作",
                type: "select",
                options: [
                    ["sing_box", "sing-box 原生规则"],
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
            field("action_value", "动作参数"),
            {
                key: "sing_box",
                label: "sing-box 规则配置",
                type: "json",
                required: true,
                hint: '支持 route、dns、outbounds。节点按选择顺序合并规则；相同标签或默认设置冲突时会拒绝保存。direct 出口自动保留。示例：{"route":{"rules":[{"domain_suffix":["example.com"],"action":"reject"}]}}',
            },
        ],
        defaults: {
            backend: "v2node",
            match: [],
            action: "block",
            sing_box: { route: { rules: [] } },
        },
    },
    users: {
        title: "用户管理",
        fetch: admin("user/fetch"),
        save: admin("user/update"),
        columns: [
            [
                "id",
                "用户（ID / 邮箱）",
                (r) => (
                    <AdminUserActivityLink
                        row={{ user_id: r.id, email: r.email }}
                    />
                ),
            ],
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
            ["currency", "账号币种", (r) => r.currency || "CNY"],
            ["balance", "余额", (r) => money(r.balance, r.currency)],
            [
                "commission_balance",
                "佣金",
                (r) => money(r.commission_balance, r.currency),
            ],
            ["last_connected_at", "上次连接", (r) => date(r.last_connected_at)],
            [
                "last_subscribe_at",
                "上次订阅时间",
                (r) => date(r.last_subscribe_at),
            ],
            ["last_login_at", "上次登录", (r) => date(r.last_login_at)],
            ["created_at", "加入时间", (r) => date(r.created_at)],
        ],
        fields: [
            field("email", "邮箱", "text", true),
            field("password", "新密码（留空不修改）", "password"),
            field("plan_id", "套餐 ID", "number"),
            field("transfer_enable", "流量 (GB)", "number"),
            field("u", "已用上传（GB）", "number"),
            field("d", "已用下载（GB）", "number"),
            {
                ...field("balance", "余额（账号币种）", "number"),
                scale: 100,
                step: 0.01,
            },
            field("expired_at", "到期时间", "datetime-local"),
            field("device_limit", "设备限制", "number"),
            field("speed_limit", "速率限制", "number"),
            toggle("banned", "禁用账户"),
            toggle("is_admin", "管理员"),
            field("discount", "专属折扣 (%)", "number"),
            field("commission_rate", "佣金比例 (%)", "number"),
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
                ...field(
                    "commission_balance",
                    "佣金余额（账号币种）",
                    "number",
                ),
                scale: 100,
                step: 0.01,
            },
            field("invite_user_email", "邀请人邮箱（留空解除）", "email"),
            field("remarks", "备注", "textarea"),
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
            ["payment_display", "支付方式"],
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
            ["user_id", "用户（ID / 邮箱）", (r) => adminUserLabel(r)],
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
                (r) => money(r.commission_balance, r.currency),
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
            field("title", "公告标题", "text", true),
            field("img_url", "封面 URL"),
            field("tags", "适用标签数组（留空表示全部）", "json"),
            { ...field("content", "内容", "textarea", true), markdown: true },
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
            field("title", "标题", "text", true),
            field("category", "分类", "text", true),
            field("language", "语言代码", "text", true),
            { ...field("body", "内容", "textarea", true), markdown: true },
            field("sort", "排序", "number"),
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
            field("name", "名称", "text", true),
            {
                key: "public_claim",
                label: "在活动中心开放领取",
                type: "switch",
            },
            {
                key: "type",
                label: "优惠类型",
                type: "select",
                options: [
                    ["1", "历史固定金额券（仅编辑）"],
                    ["2", "百分比"],
                ],
            },
            field(
                "value",
                "减免百分比（10 表示减 10%，即九折）",
                "number",
                true,
            ),
            field("generate_count", "创建模板数量", "number"),
            field("limit_use", "剩余可领取库存（留空不限）", "number"),
            field("started_at", "开始时间", "datetime-local", true),
            field("ended_at", "截止时间", "datetime-local", true),
            field("limit_plan_ids", "限制套餐 ID 数组", "json"),
            field("limit_period", "限制周期数组", "json"),
        ],
        defaults: { type: 2, public_claim: 0 },
        actions: [["切换启用", admin("coupon/show")]],
    },
    giftcards: {
        title: "礼品卡管理",
        fetch: admin("giftcard/fetch"),
        save: admin("giftcard/generate"),
        drop: admin("giftcard/drop"),
        columns: [
            ["id", "ID"],
            nameColumn,
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
            field("name", "名称", "text", true),
            field("generate_count", "数量", "number"),
            field("value", "金额（分）", "number", true),
            {
                key: "type",
                label: "礼品卡类型",
                type: "select",
                options: [
                    ["1", "余额（CNY）"],
                    ["2", "延长订阅（天）"],
                    ["3", "增加流量（GB）"],
                    ["4", "重置流量"],
                    ["5", "开通套餐"],
                ],
            },
            field("plan_id", "套餐 ID", "number"),
            field("started_at", "开始时间", "datetime-local", true),
            field("ended_at", "到期时间", "datetime-local", true),
            field("limit_use", "可用次数", "number"),
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
            nameColumn,
            ["scene", "场景"],
            ["risk_level", "风险级别"],
            ["enabled", "启用"],
        ],
        fields: [
            field("rule_key", "规则标识", "text", true),
            field("name", "名称"),
            field("description", "说明", "textarea"),
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
            field("sort", "排序", "number"),
            field("thresholds", "规则阈值", "json"),
        ],
        actions: [["恢复默认", ops("risk/rule/reset")]],
    },
    clients: {
        title: "客户端策略",
        fetch: ops("client/strategy/fetch"),
        save: ops("client/strategy/update"),

        key: "client_type",
        create: false,
        columns: [
            [
                "client_name",
                "客户端",
                (r) => (
                    <>
                        <span>{r.client_name}</span>
                        {r.min_version && (
                            <small className="muted">
                                （最低版本 {r.min_version}）
                            </small>
                        )}
                        {r.client_type === "fastai" && (
                            <div className="admin-ua-text">
                                {r.effective_minimums?.length ? (
                                    r.effective_minimums.map((target: Row) => (
                                        <small
                                            key={`${target.platform}-${target.architecture}`}
                                            style={{ display: "block" }}
                                        >
                                            {target.platform} /{" "}
                                            {target.architecture}：最低{" "}
                                            {target.effectiveMinimum ||
                                                "策略配置无效"}
                                            {!target.latestAllowed && (
                                                <strong>
                                                    {" "}
                                                    · 当前安装包版本也被拦截
                                                </strong>
                                            )}
                                        </small>
                                    ))
                                ) : (
                                    <small>
                                        未发布平台安装包；最低版本按访问策略执行。
                                    </small>
                                )}
                                {!r.is_enabled && (
                                    <small>
                                        客户端已禁用，版本满足也无法连接。
                                    </small>
                                )}
                            </div>
                        )}
                    </>
                ),
            ],
            ["is_enabled", "允许订阅访问"],
            ["ua_names", "允许的 UA 前缀"],
            [
                "top_raw_ua",
                "实际请求 UA",
                (r) => <ClientUaStats items={r.raw_ua_stats || []} />,
            ],
            ["subscribe_flag_count_24h", "24 小时请求"],
            [
                "ua_last_seen_at",
                "最近出现",
                (r) =>
                    r.ua_last_seen_at ? date(r.ua_last_seen_at) : "暂无记录",
            ],
        ],
        fields: [

            {
                ...field("min_version", "最低版本（可选）"),
                hint: "只需检查 UA 时留空。填写后还会检查对应版本，未提供版本也会拒绝。Mihomo / sing-box 填内核版本，FastAI / FlClash / Clash Verge 填应用版本。FastAI 还需满足安装包发布设置中的平台最低版本；两处限制同时生效。",
            },
            toggle("is_enabled", "允许订阅访问"),
            field("sort", "排序", "number"),
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
            field("value", "IP 地址或 CIDR", "text", true),
            field("reason", "原因"),
            toggle("is_enabled", "启用"),
            field("expired_at", "到期时间", "datetime-local"),
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
            field("ua_raw", "原始 UA", "textarea"),
            field("value", "UA 哈希（可选）"),
            field("reason", "原因"),
            toggle("is_enabled", "启用"),
        ],
        defaults: { type: "ua_hash", is_enabled: 1 },
    },
    online: {
        title: "在线用户",
        fetch: ops("risk/online-user/fetch"),
        columns: [
            [
                "user_id",
                "用户（ID / 邮箱）",
                (r) => <AdminUserActivityLink row={r} />,
            ],
            ["ip", "IP 地址"],
            ["node", "节点"],
            ["online_at", "最近活跃", (r) => date(r.online_at)],
        ],
        fields: [],
    },
    "log-login": {
        title: "登录日志",
        fetch: ops("log/login/fetch"),
        columns: [
            [
                "user_id",
                "用户（ID / 邮箱）",
                (r) => <AdminUserActivityLink row={r} />,
            ],
            ["ip", "IP"],
            ["is_success", "登录结果"],
            [
                "user_agent",
                "客户端",
                (r) => (
                    <span className="admin-ua-text">{r.recognized_client && <strong>{r.recognized_client.name} · </strong>}{r.user_agent || "—"}</span>
                ),
            ],
            ["created_at", "创建时间", (r) => logTime(r.created_at)],
        ],
        fields: [],
    },
    "log-subscribe": {
        title: "订阅日志",
        fetch: ops("log/subscribe/fetch"),
        columns: [
            [
                "user_id",
                "用户（ID / 邮箱）",
                (r) => <AdminUserActivityLink row={r} />,
            ],
            ["ip", "IP"],
            ["status", "订阅结果"],
            [
                "reason",
                "结果说明",
                (r) => {
                    const labels: Record<string, string> = {
                        client_ua_not_allowed: "客户端 UA 未被允许",
                        client_format_not_allowed: "客户端与配置格式不兼容",
                        client_disabled: "客户端已禁用",
                        client_version_too_low: "客户端版本过低",
                    };
                    return labels[r.reason] ? (
                        <span>
                            {labels[r.reason]}
                            <small
                                className="muted"
                                style={{ display: "block" }}
                            >
                                {r.reason}
                            </small>
                        </span>
                    ) : (
                        r.reason || "—"
                    );
                },
            ],
            ["client_type", "客户端类型", (r) => r.recognized_client?.name || r.client_name || r.client_type || "其他"],
            [
                "user_agent",
                "UA",
                (r) => (
                    <span className="admin-ua-text">{r.recognized_client && <strong>{r.recognized_client.name} · </strong>}{r.user_agent || "—"}</span>
                ),
            ],
            ["created_at", "创建时间", (r) => logTime(r.created_at)],
        ],
        fields: [],
    },
    "log-connection": {
        title: "连接日志",
        fetch: ops("log/user-connection/fetch"),
        columns: [
            [
                "user_id",
                "用户（ID / 邮箱）",
                (r) => <AdminUserActivityLink row={r} />,
            ],
            ["ip", "IP"],
            ["node", "节点"],
            ["connected_at", "连接时间", (r) => logTime(r.connected_at)],
        ],
        fields: [],
    },
    "log-risk": {
        title: "风控命中日志",
        fetch: ops("log/rule-hit/fetch?grouped=1"),
        columns: [
            [
                "user_id",
                "用户（ID / 邮箱）",
                (r) => <AdminUserActivityLink row={r} />,
            ],
            ["rule_name", "规则"],
            ["ip", "IP"],
            ["status", "原请求结果"],
            [
                "review",
                "最新记录复核",
                (r) => <AdminRiskReview key={r.id} row={r} />,
            ],
            ["hit_count", "命中次数"],
            ["first_hit_at", "首次命中", (r) => logTime(r.first_hit_at)],
            ["hit_at", "最后命中", (r) => logTime(r.hit_at)],
        ],
        fields: [],
    },
    "system-log": {
        title: "系统日志",
        fetch: admin("system/getSystemLog"),
        columns: [
            ["level", "级别"],
            ["title", "事件"],
            ["method", "方法"],
            ["uri", "路由"],
            ["http_status", "状态码"],
            ["duration_ms", "耗时（ms）"],
            ["request_id", "请求 ID"],
            ["created_at", "时间", (r) => logTime(r.created_at)],
        ],
        fields: [],
    },
};
export function ResourcePage({
    resource,
    queryParams = {},
    toolbar,
    extraActions,
    headerActions,
    onUserDetails,
    searchable = true,
    pageSize: initialPageSize = 20,
    onPageSizeChange,
    onTotal,
    tableSort,
    onTableSort,
    hiddenColumns = [],
}: {
    resource: Resource;
    hiddenColumns?: string[];
    queryParams?: Row;
    toolbar?: ReactNode;
    extraActions?: (row: Row, context?: boolean, secondary?: ReactNode) => ReactNode;
    headerActions?: ReactNode;
    onUserDetails?: (row: Row) => void;
    searchable?: boolean;
    pageSize?: number;
    onPageSizeChange?: (size: number) => void;
    onTotal?: (total: number) => void;
    tableSort?: { key: string; direction: string; fields: string[] };
    onTableSort?: (key: string, direction: string) => void;
}) {
    const [localPageSize, setLocalPageSize] = useState(initialPageSize);
    const pageSize = onPageSizeChange ? initialPageSize : localPageSize;
    const logKind = Object.entries(resources)
        .find(
            ([key, value]) => key.startsWith("log-") && value === resource,
        )?.[0]
        .slice(4);
    const viewKey = resource.fetch;
    const columnStorageKey = `admin.columns.${resource.fetch}`;
    const [showDisplay, setShowDisplay] = useState(false);
    const [columnViews, setColumnViews] = useState<Record<string, string[]>>({});
    let storedColumns: string[] | undefined;
    try { const saved = JSON.parse(localStorage.getItem(columnStorageKey) || "null"); if (Array.isArray(saved)) storedColumns = saved.filter(value => typeof value === "string"); } catch { /* Optional browser preference. */ }
    const selectedColumns = columnViews[columnStorageKey] ?? storedColumns ?? resource.columns.map(([key]) => key);
    const updateColumns = (columns: string[]) => {
        setColumnViews(previous => ({ ...previous, [columnStorageKey]: columns }));
        try { localStorage.setItem(columnStorageKey, JSON.stringify(columns)); } catch { /* Keep in-memory preferences. */ }
    };
    const ownDisplaySettings = resource !== resources.users;

    const [savedView] = useState(() => {
        const saved = readListView(viewKey);
        return saved.context === JSON.stringify(queryParams) &&
            saved.pageSize === pageSize
            ? saved
            : {};
    });
    const [logFilters, setLogFilters] = useState<Row>(() =>
        savedView.logFilters && typeof savedView.logFilters === "object"
            ? savedView.logFilters
            : {},
    );
    const [routeBackend, setRouteBackend] = useState(
        savedView.routeBackend === "v2box" ? "v2box" : "v2node",
    );
    const groups = useData<Row[]>(
        resource.fields.some((f) => f.key === "group_id") ||
            resource.columns.some(([key]) => key === "group_id")
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
                    suggestions: languageCodes,
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
    const [page, setPage] = useState(() =>
            Number.isInteger(savedView.page) && savedView.page > 0
                ? savedView.page
                : 1,
        ),
        [search, setSearch] = useState(() =>
            typeof savedView.search === "string" ? savedView.search : "",
        ),
        [editing, setEditing] = useState<Row | null>(null),
        [error, setError] = useState("");
    useEffect(() => {
        saveListView(viewKey, {
            context: JSON.stringify(queryParams),
            pageSize,
            page,
            search,
            logFilters,
            routeBackend,
        });
    }, [
        viewKey,
        queryParams,
        pageSize,
        page,
        search,
        logFilters,
        routeBackend,
    ]);
    const d = useData<Row[]>(
        query(resource.fetch, {
            current: page,
            page: page,
            pageSize,
            page_size: pageSize,
            email:
                resource.title.includes("日志") || resource === resources.online
                    ? search
                    : undefined,
            keyword:
                resource.serverSearch || resource.title.includes("黑名单")
                    ? search
                    : undefined,
            ...logFilters,
            ...queryParams,
            ...(resource === resources.routes ? { backend: routeBackend } : {}),
        }),
    );
    useEffect(() => {
        if (resource !== resources.clients) return;
        const timer = window.setInterval(() => {
            if (
                document.visibilityState === "visible" &&
                !editing &&
                !d.loading
            )
                d.reload();
        }, 60000);
        return () => window.clearInterval(timer);
    }, [resource, editing, d.loading, d.reload]);
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
    const secondaryActions = (r: Row) => <>
        {resource.actions?.map(([label, path, extra]) => (
            <button key={label} className={resource === resources.users ? "danger" : undefined}
                disabled={resource === resources.orders && r.status !== 0}
                onClick={() => action(path, r, extra)}>{label}</button>
        ))}
        {resource.drop && <button className="danger" onClick={() => action(resource.drop!, r)}>删除</button>}
    </>;
    const list = (d.data || []).filter(
        (r) =>
            Boolean(logKind) ||
            resource.serverSearch ||
            !search ||
            Object.values(r).some((v) =>
                String(v ?? "")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
            ),
    );
    return (
        <>
            {showDisplay && ownDisplaySettings && <AdminDisplaySettings title={`${resource.title}显示设置`}
                columns={resource.columns.filter(([key]) => !hiddenColumns.includes(key))} selected={selectedColumns}
                onChange={updateColumns} onReset={() => updateColumns(resource.columns.map(([key]) => key))} close={() => setShowDisplay(false)} />}
            <Panel
                title={resource.title}
                actions={
                    <>
                        {headerActions}
                        {ownDisplaySettings && <button type="button" onClick={() => setShowDisplay(true)}>显示设置</button>}
                        {searchable && !logKind && (
                            <div className="search">
                                <Search size={16} />
                                <input
                                    placeholder={
                                        resource === resources.online ||
                                        resource.title.includes("日志")
                                            ? "搜索邮箱…"
                                            : "搜索当前列表…"
                                    }
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value);
                                        setPage(1);
                                    }}
                                    aria-label="搜索列表"
                                />
                            </div>
                        )}
                        {(logKind || [resources.users, resources.orders, resources.online, resources.clients].includes(resource)) && (
                                <Reload
                                    onClick={d.reload}
                                    loading={d.loading}
                                />
                            )}
                        {resource.save && resource.create !== false && (
                            <button
                                className="primary"
                                onClick={() =>
                                    setEditing({
                                        ...resource.defaults,
                                        ...(resource === resources.routes
                                            ? {
                                                  backend: routeBackend,
                                                  action:
                                                      routeBackend === "v2box"
                                                          ? "sing_box"
                                                          : "block",
                                              }
                                            : {}),
                                    })
                                }
                            >
                                <Plus size={16} />
                                新建
                            </button>
                        )}
                    </>
                }
            >
                {logKind && <AdminLogTimeZone />}
                {logKind && (
                    <AdminLogFilters
                        key={logKind}
                        kind={logKind}
                        initialFilters={logFilters}
                        onApply={(filters) => {
                            setLogFilters(filters);
                            setPage(1);
                        }}
                    />
                )}
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
                {resource === resources.routes && (
                    <div className="pad">
                        <label>
                            适用内核{" "}
                            <select
                                aria-label="路由内核"
                                value={routeBackend}
                                onChange={(e) => {
                                    setRouteBackend(e.target.value);
                                    setPage(1);
                                }}
                            >
                                <option value="v2node">V2Node / Xray</option>
                                <option value="v2box">V2Box / sing-box</option>
                            </select>
                        </label>
                        <p className="muted">
                            两类规则独立维护。修改规则会应用到选择它的节点；正在使用的规则不能删除。
                        </p>
                    </div>
                )}
                {resource === resources.online && (
                    <p className="pad muted">
                        近 10 分钟活跃且有节点缓存记录；不是即时连接状态。用户{" "}
                        {d.meta?.users ?? "—"} · IP {d.meta?.ips ?? "—"} ·
                        连接记录 {d.total} · 查询时间 {date(d.meta?.updated_at)}
                        。节点未上报时可能不显示。
                    </p>
                )}
                {resource === resources["log-risk"] && (
                    <p className="admin-log-note muted">
                        近 30 天，同一用户、规则、IP 和处理结果按固定 10
                        分钟窗口合并；总数为合并后的事件数。点击用户查看原始活动。
                    </p>
                )}
                <State {...d} retry={d.reload}>
                    {error && <div className="alert">{error}</div>}
                    <Table
                        data={list}
                        columns={resource.columns
                            .filter(([key]) => !hiddenColumns.includes(key) && (!ownDisplaySettings || selectedColumns.includes(key)))
                            .map(([key, label, render]) => {
                                if (resource === resources.users && key === "id" && onUserDetails)
                                    return [key, label, (r: Row) => <button className="link" onClick={() => onUserDetails(r)}>{adminUserLabel({user_id:r.id,email:r.email})}</button>] as [string,string,(r:Row)=>ReactNode];
                                if (key === "group_id" && !render)
                                    return [
                                        key,
                                        label,
                                        (r: Row) => {
                                            if (r.group_id == null) return "—";
                                            const group = rows(
                                                groups.data,
                                            ).find(
                                                (g) =>
                                                    String(g.id) ===
                                                    String(r.group_id),
                                            );
                                            return (
                                                group?.name ||
                                                `未知权限组 (#${r.group_id})`
                                            );
                                        },
                                    ] as [
                                        string,
                                        string,
                                        (r: Row) => ReactNode,
                                    ];
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
                            })}
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
                                              (resource.create !== true ||
                                                  resource ===
                                                      resources.coupons) && (
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
                                                                  ] =
                                                                      dateTimeInput(
                                                                          Number(
                                                                              item[
                                                                                  field
                                                                                      .key
                                                                              ],
                                                                          ),
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
                                          {resource !== resources.users || !extraActions ? secondaryActions(r) : null}
                                          {extraActions?.(r, context, resource === resources.users ? secondaryActions(r) : undefined)}
                                      </>
                                  )
                                : undefined
                        }
                    />
                    {(d.total > 0 || !d.loading) && (
                        <Pager
                            page={page}
                            total={d.total}
                            size={pageSize}
                            loading={d.loading}
                            onSizeChange={(size) => {
                                setPage(1);
                                if (onPageSizeChange) onPageSizeChange(size);
                                else setLocalPageSize(size);
                            }}
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
                    {resource === resources.coupons && editing.id && (
                        <p className="alert" role="note">
                            修改仅影响今后领取的券。已领取的券保留原优惠和有效期，历史订单不变。剩余库存是当前可继续发放的数量；停用入口不会撤销已领取的券。
                        </p>
                    )}
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
                                    if (
                                        resource === resources.routes &&
                                        editing.id
                                    )
                                        clean.backend =
                                            editing.backend || "v2node";
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
        <Panel title="套餐翻译">
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
                            field("name", "翻译名称"),
                            field(
                                "content",
                                "翻译说明（JSON / HTML）",
                                "textarea",
                            ),
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
export function System() {
    const status = useData(admin("system/getSystemStatus")),
        queue = useData(admin("system/getQueueStats"));
    return (
        <>
            <SystemHealth />
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
                            actions={
                                <Reload
                                    onClick={data.reload}
                                    loading={data.loading}
                                />
                            }
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

export { Nodes } from "./admin-nodes";
export { Payments } from "./admin-payments";
export { Settings } from "./admin-settings";
