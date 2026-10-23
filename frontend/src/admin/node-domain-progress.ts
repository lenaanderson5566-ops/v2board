import type { Row } from "../shared/api";

export function nodeDomainProgress(
    binding: Row,
    node: Row,
    now = Date.now() / 1000,
) {
    const families =
        binding.family === "dual" ? ["ipv4", "ipv6"] : [binding.family];
    const missing = families.filter(
        (f) =>
            !binding[f] ||
            Number(binding[`${f}_seen_at`]) < now - 900 ||
            !Number(binding[`${f}_seen_at`]),
    );
    const reportsReady = missing.length === 0;
    const dnsReady =
        (!binding.entry_id || binding.entry_ready) &&
        reportsReady &&
        ["healthy", "ready_to_switch"].includes(binding.status) &&
        Number(binding.last_success) >= now - 900;
    const pending = binding.tls_transition_state === "pending";
    const failed = binding.tls_transition_state === "failed";
    const published = binding.published_domain || node.host;
    const active =
        published === (binding.connection_domain || binding.domain) &&
        (!binding.entry_id ||
            Number(binding.published_port) === Number(binding.entry_port)) &&
        !pending &&
        !failed;
    const unsupported =
        Number(node.tls) === 1 && !binding.certificate_transition_supported;
    let title = "下一步：等待解析同步";
    let description =
        "IP 已收到，等待面板同步 DNS。页面会自动更新，无需重复保存域名。";
    if (binding.server_enabled === false) {
        title = "下一步：启用所属服务器";
        description =
            "所属服务器已停用，请在服务器管理中编辑所属服务器，恢复上报与解析同步。";
    } else if (!binding.enabled) {
        title = "下一步：启用域名绑定";
        description = "此绑定已停用。请在 域名与解析 中恢复后继续。";
    } else if (!binding.managed) {
        title = "此绑定仅同步 DNS";
        description =
            "节点连接地址需在节点设置中维护；此处不会自动切换订阅地址。";
    } else if (pending) {
        title = "正在验证新域名";
        description =
            "等待节点验证新证书与监听，成功后自动切换。当前域名继续生效，请勿重复部署。";
    } else if (!reportsReady) {
        title = "下一步：检查 IP 上报";
        description = `尚未收到有效的 ${missing.map((f) => (f === "ipv4" ? "IPv4" : "IPv6")).join("、")} 上报。新节点请执行一键部署；已开始部署请按终端提示恢复，已安装节点可在高级维护中修复上报。仅使用 IPv4 的服务器请选择 IPv4。`;
    } else if (binding.status === "ownership_conflict") {
        title = "下一步：核对现有解析";
        description =
            "目标域名已有未托管的解析。请预览记录，确认属于此节点后接管。";
    } else if (binding.status === "credential_rejected") {
        title = "下一步：检查 Cloudflare 凭据";
        description =
            "请在 域名与解析 中检查 Token 权限与 Zone，再重试 DNS 同步。";
    } else if (binding.status === "host_changed") {
        title = "下一步：重新确认域名设置";
        description = "节点地址已被修改。请展开域名设置，核对并重新保存绑定。";
    } else if (binding.status === "ambiguous_records") {
        title = "下一步：核对重复解析";
        description =
            "目标域名存在多条同类记录。请在 Cloudflare 核对并处理后重试 DNS 同步。";
    } else if (active) {
        title = "新域名已生效";
        description =
            "节点列表和新订阅使用当前生效域名。已有客户端请更新订阅。";
    } else if (dnsReady && unsupported) {
        title = "下一步：升级 V2Box";
        description =
            "解析已就绪，但节点尚未上报证书切换能力。请升级至 v1.0.5 或更新版本，等待节点重新连接后继续。仅更新面板不会完成此步骤。";
    } else if (dnsReady) {
        title = failed
            ? "下一步：检查日志后重新验证"
            : "下一步：验证并切换地址";
        description = failed
            ? "上次验证未完成，当前域名仍然生效。请检查 v2box log，处理证书或监听错误后重试。"
            : "IP 上报和解析同步已完成。点击“验证并切换地址”，验证成功后才更新节点列表与订阅地址。无需再次保存域名或配置 IP 上报。";
    } else if (binding.status === "rate_limited") {
        description =
            "Cloudflare 正在限流，系统会退避重试。无需重复保存或配置上报。";
    }
    return {
        title,
        description,
        reportsReady,
        dnsReady,
        pending,
        active,
        needsUpgrade:
            !!binding.enabled &&
            binding.server_enabled !== false &&
            !!binding.managed &&
            dnsReady &&
            !active &&
            !pending &&
            unsupported,
        canActivate:
            !!binding.enabled &&
            binding.server_enabled !== false &&
            !!binding.managed &&
            dnsReady &&
            !active &&
            !pending &&
            !unsupported,
    };
}
