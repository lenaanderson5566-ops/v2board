// One canonical workspace per task; each tab keeps a bookmarkable route.
export const adminWorkspaces = [
    {
        root: "payments",
        label: "支付与充值",
        tabs: [
            ["payments", "支付渠道"],
            ["payment-deposit", "充值规则"],
        ],
    },
    {
        root: "clients",
        label: "客户端访问与接入",
        tabs: [
            ["clients", "访问与版本策略"],
            ["client-entrypoints", "服务入口"],
        ],
    },
    {
        root: "site-settings",
        label: "站点设置",
        tabs: [
            ["site-settings", "基础信息"],
            ["browser-settings", "浏览器引导"],
            ["footer-settings", "页脚内容"],
        ],
    },
    {
        root: "notification-settings",
        label: "通知设置",
        tabs: [
            ["notification-settings", "邮件"],
            ["telegram-settings", "Telegram"],
            ["notification-blocklist", "邮件禁发名单"],
        ],
    },
    {
        root: "plans",
        label: "套餐与订阅",
        tabs: [
            ["plans", "套餐管理"],
            ["subscription-settings", "订阅设置"],
        ],
    },
    {
        root: "tickets",
        label: "工单管理",
        tabs: [
            ["tickets", "工单列表"],
            ["ticket-settings", "工单设置"],
        ],
    },
    {
        root: "invitations",
        label: "邀请与奖励",
        tabs: [
            ["invitations", "邀请与奖励"],
            ["invitation-rules", "佣金规则"],
        ],
    },
    {
        root: "nodes",
        label: "节点管理",
        tabs: [
            ["nodes", "节点列表"],
            ["node-services", "代理服务"],
            ["node-forwarding", "入口转发"],
            ["node-settings", "节点通讯"],
        ],
    },
    {
        root: "servers",
        label: "服务器管理",
        tabs: [["servers", "服务器列表"], ["server-lightsail", "Lightsail IP"]],
    },
    {
        root: "access-blacklist",
        label: "订阅访问黑名单",
        tabs: [
            ["access-blacklist", "订阅 IP 黑名单"],
            ["access-blacklist-ua", "订阅 UA 黑名单"],
        ],
    },
    {
        root: "access-logs",
        label: "访问日志",
        tabs: [
            ["access-logs", "登录日志"],
            ["access-logs-subscriptions", "订阅请求"],
            ["access-logs-connections", "连接日志"],
            ["access-logs-risk", "风控命中"],
        ],
    },
];
export function adminWorkspace(current: string) {
    return adminWorkspaces.find((group) =>
        group.tabs.some(([route]) => route === current),
    );
}
export const settingSections: Record<string, string> = {
    "site-settings": "site",
    "browser-settings": "browser",
    "footer-settings": "footer",
    "notification-settings": "email",
    "telegram-settings": "telegram",
    "account-settings": "safe",
    "subscription-settings": "subscribe",
    "ticket-settings": "ticket",
    "node-settings": "server",
    "client-entrypoints": "entrypoints",
    "payment-deposit": "deposit",
    "invitation-rules": "invite",
};
