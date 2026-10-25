// The state comes from Laravel AccountStatusService, not a client expiry guess.
export function userNavigation(state?: string) {
    if (state === "banned") return [];
    return [
        {
            key: "dashboard",
            label: state === "active" ? "使用情况" : "总览",
            group: "工作空间",
        },
        state === "active"
            ? { key: "subscribe", label: "配置中心", group: "工作空间" }
            : {
                  key: "plan",
                  label: state === "expired" ? "续订套餐" : "购买订阅",
                  group: "工作空间",
              },
        { key: "order", label: "账单", group: "工作空间" },
        { key: "knowledge", label: "帮助中心", group: "帮助" },
    ];
}

export function ticketOrderReference(path: string): string | undefined {
    const parts = path.split("/");
    if (parts[0] !== "ticket" || parts[1] !== "order" || parts.length !== 3) return;
    try {
        const value = decodeURIComponent(parts[2]);
        return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : undefined;
    } catch { return undefined; }
}
