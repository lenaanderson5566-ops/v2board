import type { ReactNode } from "react";
import { formatNumber, formatPercent } from "../shared/number-format";
import { languages } from "../shared/language-options";
import { admin, bytes, date, money, ops, type Row } from "../shared/api";
import type { Field } from "../shared/ui";
import { logTime } from "./admin-log-time";
import { AdminSubscriptionExpiry } from "./AdminSubscriptionExpiry";
import { AdminRiskReview } from "./AdminRiskReview";
import { AdminUserActivityLink } from "./AdminUserActivity";
import { ClientUaStats } from "./ClientUaStats";
import { field, nameColumn, resetOptions } from "./admin-fields";
import { adminUserLabel } from "./admin-user-label";
import { adminOrderPeriod, adminOrderType } from "./admin-order-labels";
import { nodeRoutePresets, routeSummary } from "./node-route-presets";
import { routeActionLabel, routeDetails } from "./route-form";
import type { Resource } from "./admin";

const toggle = (key: string, label: string): Field => ({
    key,
    label,
    type: "switch",
    options: [
        ["1", "开启"],
        ["0", "关闭"],
    ],
});
const created: [string, string, ((r: Row) => ReactNode)?] = [
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
            ? "额度包价格；流量 (GiB) 为额度数量。仅在用户的额度入口展示，可独立使用，套餐重置不会补回额度。"
            : "留空表示不提供该支付周期",
});
export const resources: Record<string, Resource> = {
    plans: {
        kind: "plans",
        title: "套餐管理",
        fetch: admin("plan/fetch"),
        sort: admin("plan/sort"),
        sortKind: "plans",
        save: admin("plan/save"),
        drop: admin("plan/drop"),
        columns: [
            nameColumn,
            ["show", "展示"],
            ["renew", "允许续费"],
            ["count", "统计"],
            ["transfer_enable", "流量 (GiB)", (record) => formatNumber(record.transfer_enable)],
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
        ],
        fields: [
            field("name", "套餐名称", "text", true),
            field("group_id", "权限组 ID", "number", true),
            field("transfer_enable", "流量 (GiB)", "number", true),
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
    },
    groups: {
        kind: "groups",
        title: "节点权限组",
        fetch: admin("server/group/fetch"),
        save: admin("server/group/save"),
        drop: admin("server/group/drop"),
        columns: [
            ["id", "组ID"],
            ["name", "组名称"],
            ["user_count", "用户数量"],
            ["plan_count", "套餐数量"],
            ["server_count", "节点数量"],
        ],
        fields: [field("name", "权限组名称", "text", true)],
    },
    routes: {
        kind: "routes",
        title: "路由管理",
        fetch: admin("server/route/fetch"),
        save: admin("server/route/save"),
        drop: admin("server/route/drop"),
        columns: [
            ["id", "ID"],
            ["remarks", "备注"],
            [
                "match",
                "配置内容",
                r => <div className="route-rule-summary"><span>{routeDetails(r)}</span><small className="muted">{routeSummary(r)}</small></div>,
            ],
            ["node_count", "引用服务", r => r.used_by?.length ? <details><summary>{r.node_count || 0} 个服务</summary><ul>{r.used_by.map((node: Row) => <li key={node.id}>{node.name}（#{node.id}）</li>)}</ul></details> : `${r.node_count || 0} 个`],
            [
                "action",
                "格式 / 动作",
                routeActionLabel,
            ],
        ],
        fields: [
            field("remarks", "备注", "text", true),
            {
                key: "route_template", label: "配置模板", type: "select",
                options: [["", "选择模板（保留当前配置）"], ...nodeRoutePresets.map(p => [p.id, p.label] as [string, string])],
                hint: "选择模板会替换当前 JSON。请修改示例域名、服务器和规则集地址后保存。",
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
                hint: "适配 sing-box 1.14.3：支持 route、typed DNS、outbounds 和 HTTPS 规则集。direct 出口自动保留。多条规则按选择顺序合并，节点保存时检查标签引用与设置冲突。",
            },
        ],
        defaults: {
            backend: "v2box",
            route_template: "",
            match: [],
            action: "sing_box",
            sing_box: { route: { rules: [] } },
        },
    },
    users: {
        kind: "users",
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
            ["language", "用户语言", (r) => {
                const code = typeof r.language === "string" ? r.language.trim() : "";
                return languages.find((language) => language.code === code)?.name ?? (code || "未设置");
            }],
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
                "已用（GiB）",
                (r) => r.total_used == null ? "—" : formatNumber(Number(r.total_used) / 1073741824),
            ],
            [
                "transfer_enable",
                "流量（GiB）",
                (r) => r.transfer_enable == null ? "—" : formatNumber(Number(r.transfer_enable) / 1073741824),
            ],
            [
                "device_limit",
                "设备数",
                (r) => <span title="按有效节点上报的来源 IP 估算，受统计模式及流量阈值影响，不等于实际设备数。">
                    {r.alive_ip || 0} / {r.device_limit || "不限"}
                </span>,
            ],
            ["expired_at", "订阅到期", (r) => <AdminSubscriptionExpiry user={r} />],
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
            field("plan_id", "套餐", "number"),
            field("transfer_enable", "流量 (GiB)", "number"),
            field("u", "已用上传（GiB）", "number"),
            field("d", "已用下载（GiB）", "number"),
            {
                ...field("balance", "余额（账号币种）", "number"),
                scale: 100,
                step: 0.01,
            },
            {
                ...field("expired_at", "订阅到期", "datetime-local"),
                hint: "仅填写订阅的到期日期。只改余额时会保留原到期值。流量额度包的到期日在用户详情的「流量额度包」中查看。",
            },
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
        kind: "orders",
        title: "订单管理",
        fetch: admin("order/fetch"),
        columns: [
            created,
            ["status", "状态", (r) => ["待支付", "开通中", "已取消", "已完成", "已折抵"][r.status]],
            ["total_amount", "金额", (r) => money(r.total_amount, r.currency)],
            ["user_id", "用户（ID / 邮箱）", (r) => adminUserLabel(r)],
            ["type", "类型", adminOrderType],
            ["plan_name", "套餐"],
            ["payment_display", "支付方式"],
            ["period", "周期", adminOrderPeriod],
            [
                "credit_bytes",
                "额度数量",
                (r) => (r.credit_bytes ? bytes(r.credit_bytes) : "—"),
            ],
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
        ],
        fields: [],
        actions: [
            ["标记已付款", admin("order/paid")],
            ["取消", admin("order/cancel")],
        ],
    },
    notices: {
        kind: "notices",
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
        kind: "knowledge",
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
        kind: "coupons",
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
                        : `比例优惠 ${formatPercent(r.value, { bounded: true })}`,
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
            field("limit_plan_ids", "适用套餐", "json"),
            field("limit_period", "限制周期数组", "json"),
        ],
        defaults: { type: 2, public_claim: 0 },
        actions: [["切换启用", admin("coupon/show")]],
    },
    giftcards: {
        kind: "giftcards",
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
                    ["3", "增加流量（GiB）"],
                    ["4", "重置流量"],
                    ["5", "开通套餐"],
                ],
            },
            field("plan_id", "套餐", "number"),
            field("started_at", "开始时间", "datetime-local", true),
            field("ended_at", "到期时间", "datetime-local", true),
            field("limit_use", "可用次数", "number"),
        ],
        defaults: { generate_count: 1, type: 1 },
    },
    risk: {
        kind: "risk",
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
        kind: "clients",
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
    "access-blacklist": {
        kind: "access-blacklist",
        title: "订阅 IP 黑名单",
        fetch: ops("risk/blacklist/ip/fetch"),
        save: ops("risk/blacklist/ip/update"),
        drop: ops("risk/blacklist/ip/delete"),
        columns: [
            ["id", "ID"],
            ["value", "IP / CIDR"],
            ["remark", "原因"],
            ["expires_at", "到期时间", (r) => r.expires_at ? date(r.expires_at) : "永久"],
            ["is_enabled", "启用"],
        ],
        fields: [
            field("value", "IP 地址或 CIDR", "text", true),
            field("remark", "原因"),
            toggle("is_enabled", "启用"),
            field("expires_at", "到期时间", "datetime-local"),
        ],
        defaults: { type: "ip", is_enabled: 1 },
    },
    "access-blacklist-ua": {
        kind: "access-blacklist-ua",
        title: "订阅 UA 黑名单",
        fetch: ops("risk/blacklist/ua/fetch"),
        save: ops("risk/blacklist/ua/update"),
        drop: ops("risk/blacklist/ua/delete"),
        columns: [
            ["id", "ID"],
            ["ua_raw", "原始 UA"],
            ["value", "UA 哈希"],
            ["remark", "原因"],
            ["expires_at", "到期时间", (r) => r.expires_at ? date(r.expires_at) : "永久"],
            ["is_enabled", "启用"],
        ],
        fields: [
            field("ua_raw", "原始 UA", "textarea"),
            field("value", "UA 哈希（可选）"),
            field("remark", "原因"),
            toggle("is_enabled", "启用"),
            field("expires_at", "到期时间", "datetime-local"),
        ],
        defaults: { type: "ua_hash", is_enabled: 1 },
    },
    online: {
        kind: "online",
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
    "access-logs": {
        kind: "access-logs",
        logKind: "login",
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
    "access-logs-subscriptions": {
        kind: "access-logs-subscriptions",
        logKind: "subscribe",
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
                        subscription_ip_blacklisted: "订阅 IP 黑名单拦截",
                        subscription_ua_blacklisted: "订阅 UA 黑名单拦截",
                        client_format_not_allowed: "客户端与配置格式不兼容",
                        client_disabled: "客户端已禁用",
                        client_version_too_low: "客户端版本过低",
                        traffic_exhausted: "套餐流量已用尽",
                        credits_expired: "独立额度已过期",
                        credits_exhausted: "独立额度已用尽",
                        no_available_nodes: "暂无可用节点",
                        subscription_changed: "订阅状态已变化",
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
    "access-logs-connections": {
        kind: "access-logs-connections",
        logKind: "connection",
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
    "access-logs-risk": {
        kind: "access-logs-risk",
        logKind: "risk",
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
        kind: "system-log",
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
