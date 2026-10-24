import type { Row } from "../shared/api";

const failures: Record<string, string> = {
    ownership_conflict: "解析记录不属于当前托管绑定，请核对并接管记录",
    ambiguous_records: "存在重复解析，请处理同名同类型记录",
    credential_rejected: "Cloudflare 拒绝凭据，请检查区域与 DNS 编辑权限",
    credential_unreadable: "Cloudflare 凭据无法读取，请重新保存凭据",
    host_changed: "连接地址与绑定不一致，请核对连接与域名设置",
    configuration_rejected: "Cloudflare 拒绝解析配置，请检查区域及记录",
    provider_rejected: "Cloudflare 拒绝请求，请检查凭据与域名配置",
    unexpected_record: "解析记录与预期不一致，请核对现有记录",
};

export function deploymentDnsSteps(binding: Row, network: Row, now = Date.now() / 1000) {
    return [
        { role: "回源", binding },
        ...(binding.entry_id ? [{ role: "入口", binding: (network.assignments || []).find((a: Row) => Number(a.id) === Number(binding.entry_id)) }] : []),
    ].map(({ role, binding: a }) => {
        const label = `${role} IP 与解析`;
        const result = (state: string, detail: string, next: string) => ({ label, state, detail, next });
        if (!a) return result("unknown", "未找到入口域名绑定", "在服务器管理中核对入口域名，再重新选择入口。");
        const server = (network.servers || []).find((s: Row) => Number(s.id) === Number(a.server_id));
        const credential = (network.credentials || []).find((c: Row) => Number(c.id) === Number(a.credential_id));
        const scope = `${server?.name || `服务器 #${a.server_id || "—"}`} · ${a.domain}`;
        if (!a.enabled || server?.enabled === false || server?.enabled === 0)
            return result("fail", `${scope}：服务器或域名已停用`, "在服务器管理或连接与域名中启用后继续。");
        if (!server) return result("unknown", `${scope}：服务器关联信息缺失`, "刷新状态；若仍缺失，请核对所属服务器。");
        const missing = (a.family === "dual" ? ["ipv4", "ipv6"] : [a.family]).filter(f => !a[f] || !Number(a[`${f}_seen_at`]) || Number(a[`${f}_seen_at`]) < now - 900);
        if (missing.length) return result("unknown", `${scope}：${missing.map(f => f === "ipv4" ? "IPv4" : "IPv6").join("、")} 未上报或已超过 15 分钟`, role === "入口" ? "在入口服务器的管理页面检查 IP 上报；代理服务器上报不能代替入口。" : "确认部署命令在此代理服务器执行；只使用 IPv4 时，将服务器及回源域名设置为 IPv4。");
        const failure = failures[credential?.status] || failures[a.status];
        if (failure || !credential || Number(a.next_run) < 0 || Number(credential?.next_run) < 0)
            return result("fail", `${scope}：${failure || "解析同步已暂停或凭据缺失"}`, "在域名与解析中修正原因后重试同步；无需重新安装节点。");
        if (Number(credential.next_run) > now)
            return result("unknown", `${scope}：Cloudflare 正在退避，约 ${Math.ceil((Number(credential.next_run) - now) / 60)} 分钟后重试`, "等待自动重试，避免反复保存或轮换凭据。");
        if (["healthy", "ready_to_switch"].includes(a.status) && Number(a.last_success) >= now - 900)
            return result("pass", `${scope}：面板解析同步已完成`, "公共解析是否生效请使用下方“一键检查”；同步完成不等于公网连通。");
        return result("unknown", `${scope}：IP 已收到，等待解析同步`, "保持部署任务运行，它会推进到期同步；长期同步仍需面板定时任务正常运行。");
    });
}

export function NodeDeploymentProgress({ binding, network, runtime }: { binding?: Row; network?: Row | null; runtime?: Row | null }) {
    const steps = binding && network ? deploymentDnsSteps(binding, network) : [];
    const error = ({ certificate: "证书申请或加载失败，请核对 TLS 身份、Cloudflare 证书凭据和证书模式。", start: "服务启动失败，请核对端口占用及监听地址。", decode: "节点无法解析配置，请核对节点版本与协议配置。", users: "用户配置应用失败，请检查节点同步及运行诊断。", core: "协议内核未能应用配置，请检查协议参数及运行诊断。" } as Record<string, string>)[runtime?.errorCode] || "节点未能应用配置，请打开运行诊断检查错误。";
    steps.push({ label: "配置、证书与监听", state: runtime?.configurationState === "invalid" || runtime?.applicationState === "failed" ? "fail" : runtime?.applicationState === "applied" && runtime?.runtimeStatus === "online" ? "pass" : "unknown", detail: runtime?.configurationState === "invalid" ? "当前配置无法下发" : runtime?.applicationState === "failed" ? error : runtime?.applicationState === "applied" && runtime?.runtimeStatus === "online" ? "节点已确认应用当前配置" : "尚未收到当前配置的有效应用确认", next: runtime?.configurationState === "invalid" ? "检查协议与证书设置及凭据后保存。" : "先完成 IP 与解析步骤，再查看运行诊断及下方一键检查；没有回执不能认定证书或监听成功。" });
    return <section aria-label="部署步骤与处理建议" className="admin-deployment-card">
        <h3>部署步骤与处理建议</h3>
        <p className="muted">依据最近的上报、解析同步及配置回执显示。服务器安装进程和公共网络结果需另行确认；下方“一键检查”可验证当前公网状态。</p>
        {!binding && <p className="muted">未读取到托管域名绑定，无法判断自动解析步骤。请核对连接与域名设置；手动维护的域名请使用一键检查。</p>}
        <ol className="deployment-check-list">{steps.map(step => <li key={step.label}>
            <div className="deployment-check-heading"><strong>{step.label}</strong><span className={`deployment-check-state is-${step.state}`}>{step.state === "pass" ? "已确认" : step.state === "fail" ? "需处理" : "待确认"}</span></div>
            <p>{step.detail}</p><p className="muted">下一步：{step.next}</p>
        </li>)}</ol>
    </section>;
}
