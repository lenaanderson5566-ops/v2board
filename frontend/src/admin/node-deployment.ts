import type { Row } from "../shared/api";
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export const nodeUpgradeCommand = (node: Row): string =>
    String(node.upgrade_command || "");

const taskPhases: Record<string, { label: string; hint: string; polling?: boolean }> = {
    issued: { label: "等待执行部署命令", hint: "在目标代理服务器上执行本次命令。", polling: true },
    redeemed: { label: "授权已领取，等待节点确认", hint: "若安装中断，有本地进度时运行 v2box resume；若终端提示未保存进度，请检查凭据轮换后重新生成命令。", polling: true },
    preparing: { label: "节点正在准备部署", hint: "已保存部署进度。若任务中断，在原服务器运行 v2box resume。", polling: true },
    applying: { label: "等待本次配置应用确认", hint: "等待本次节点凭据、配置和监听的验收结果。若任务中断，在原服务器运行 v2box resume。", polling: true },
    failed: { label: "本次配置应用失败", hint: "查看 v2box log 和终端提示。修正原因后，在本次授权有效期内运行 v2box resume。", polling: true },
    completed: { label: "本次部署已完成", hint: "" },
    legacy: { label: "授权已领取，旧版未提供部署回执", hint: "请通过节点上的 v2box status 和客户端连接检查确认结果。" },
    command_expired: { label: "部署命令已过期", hint: "命令在有效期内未领取，请生成新命令。已准备好的程序可直接接入。" },
    recovery_expired: { label: "部署恢复期限已过", hint: "请生成新命令接入，服务器上的配置与证书可继续使用。" },
    invalidated: { label: "本次授权已失效", hint: "请核对当前节点配置与凭据，然后生成新命令。" },
};

export function deploymentTaskState(task?: Row | null) {
    if (!task) return { label: "暂无部署任务", hint: "", polling: false };
    return taskPhases[task.phase] || { label: "等待更新任务状态", hint: "", polling: true };
}
export function nodeDeploymentCommand(node: Row): string {
    const base = String(node.install_command || "");
    if (!node.ddns) return base;
    const domain = String(node.ddns_domain || "").trim();
    const family = ["ipv4", "ipv6", "dual"].includes(node.ddns_family)
        ? node.ddns_family
        : "ipv4";
        return (
            base +
            " --ddns" +
            (domain ? " --ddns-domain " + quote(domain) : "") +
            " --ddns-family " +
            family
        );
}
