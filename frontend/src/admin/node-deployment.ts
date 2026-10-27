import type { Row } from "../shared/api";
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export const nodeUpgradeCommand = (node: Row): string =>
    String(node.upgrade_command || "");
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
