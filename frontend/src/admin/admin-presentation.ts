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
        .filter(
            (field) => !(group === "site" && field.key === "currency_symbol"),
        )
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
                    "region_code",
                    "city_code",
                    "display_label",
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
                      "type",
                      "value",
                      "started_at",
                      "ended_at",
                      "limit_use",
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

export const adminLabels: Record<string, string> = {
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
    fastai_enabled: "启用 FastAI 客户端",
    fastai_releases: "FastAI 客户端版本与下载",
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
    invite_registration_gb: "受邀注册奖励（GB，0 为关闭）",
    invite_credit_months: "邀请赠送额度有效期（月，默认 1）",
    invite_first_use_gb: "受邀首次使用奖励（GB，0 为关闭）",
    invite_gen_limit: "待接受邮件邀请数量限制",
    commission_withdraw_limit: "最低提现金额",
    commission_withdraw_method: "提现方式",
    email_host: "SMTP 主机",
    email_port: "SMTP 端口",
    email_username: "SMTP 用户名",
    apple_account_url: "AppleAuto 接口地址（HTTPS 域名）",
    apple_account_enable: "启用 iOS 下载账号",
    apple_account_token: "AppleAuto API Key（留空保留，仅服务端保存）",
    client_primary_android: "android · 主推荐客户端",
    client_secondary_android: "android · 备选客户端",
    client_primary_windows: "windows · 主推荐客户端",
    client_secondary_windows: "windows · 备选客户端",
    client_primary_macos: "macos · 主推荐客户端",
    client_secondary_macos: "macos · 备选客户端",
    client_primary_linux: "linux · 主推荐客户端",
    client_secondary_linux: "linux · 备选客户端",
    client_primary_ios: "ios · 主推荐客户端",
    client_secondary_ios: "ios · 备选客户端",
    apple_account_share: "AppleAuto 分享代码",
    email_password: "SMTP 密码",
    email_encryption: "SMTP 加密方式",
    email_from_address: "发件人地址",
    telegram_bot_enable: "启用 Telegram 机器人",
    telegram_bot_token: "机器人 Token",
    telegram_discuss_id: "用户群 ID（负数）",
    telegram_group_policy_enable: "启用群成员资格管理",
    telegram_group_grace_days: "套餐到期宽限天数（0–30，默认 3）",
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
