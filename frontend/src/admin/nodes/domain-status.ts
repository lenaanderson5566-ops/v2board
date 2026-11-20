export const domainStatus: Record<string, string> = {
    manual: "手动维护",
    awaiting_report: "等待 IP 上报",
    healthy: "解析正常",
    ready_to_switch: "解析就绪，待切换地址",
    ownership_conflict: "同名解析归属不符",
    pending_cleanup: "等待清理",
    still_in_use: "仍被节点或证书引用",
    network_error: "网络异常，等待重试",
    credential_rejected: "凭据无效或权限不足",
    rate_limited: "Cloudflare 限流",
    host_changed: "节点地址已变化，请重新保存域名绑定",
    ambiguous_records: "同名解析不唯一，请核查",
    unexpected_record: "解析响应异常，等待重试",
    provider_error: "Cloudflare 服务异常",
    dns_adopted: "已接管现有解析",
    unused_dns_removed: "已删除确认废弃的解析",
};

export const certificateTransitionStatus: Record<string, string> = {
    pending: "正在验证证书与节点就绪状态，当前地址继续保留",
    failed: "切换未完成，已保留原配置。请检查节点日志后重试",
    applied: "域名与证书已同步",
};
