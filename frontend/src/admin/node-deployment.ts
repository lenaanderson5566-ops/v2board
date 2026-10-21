import type { Row } from "../shared/api";
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export const nodeUpgradeCommand = "curl -fSL https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.2/script/install.sh -o install-v2box.sh && bash install-v2box.sh v1.0.2";
export const nodeIPCommand =
    "curl -fSL https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.2/script/node-network.py -o node-network.py && python3 node-network.py ip";
export function nodeDeploymentCommand(node: Row): string {
    const base = String(node.install_command || "");
    if (!node.ddns) return base;
    const domain = String(node.ddns_domain || "").trim();
    const family = ["ipv4", "ipv6", "dual"].includes(node.ddns_family)
        ? node.ddns_family
        : "ipv4";
    if (node.type === "v2box")
        return (
            base +
            " --ddns" +
            (domain ? " --ddns-domain " + quote(domain) : "") +
            " --ddns-family " +
            family
        );
    return (
        base +
        " && curl -fSL https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.2/script/node-network.py -o node-network.py && python3 node-network.py configure" +
        (domain ? " --domain " + quote(domain) : "") +
        " --family " +
        family
    );
}

export function nodeReportCommand(family: string): string {
    const f = ["ipv4", "ipv6", "dual"].includes(family) ? family : "ipv4";
    return (
        "curl -fSL https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.2/script/node-network.py -o node-network.py && python3 node-network.py report-configure --family " +
        f
    );
}
