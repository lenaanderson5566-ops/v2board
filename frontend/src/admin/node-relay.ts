import type { Row } from "../shared/api";

/** A stream-context fragment: TLS stays on the origin; DNS changes are resolved at runtime. */
export function relayStreamConfig(binding: Row, node: Row, entry: Row): string {
    const port = Number(binding.entry_port),
        originPort = Number(node.server_port);
    const validPort = (p: number) => Number.isInteger(p) && p > 0 && p <= 65535;
    if (
        !validPort(port) ||
        !validPort(originPort) ||
        !Number.isInteger(Number(binding.id)) || Number(binding.id) < 1 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
            binding.domain || "",
        )
    )
        return "";
    const name = `v2box_${binding.scope === "connection" ? "connection" : "origin"}_${binding.id}`;
    const transports = ["hysteria", "hysteria2", "tuic"].includes(node.protocol)
        ? ["udp"]
        : node.protocol === "shadowsocks"
          ? ["tcp", "udp"]
          : ["tcp"];
    const family =
        binding.family === "ipv4"
            ? " ipv6=off"
            : binding.family === "ipv6"
              ? " ipv4=off"
              : "";
    const upstream = `upstream ${name} {\n    zone ${name} 64k;\n    resolver 1.1.1.1 8.8.8.8 valid=30s${family};\n    resolver_timeout 5s;\n    server ${binding.domain}:${originPort} resolve;\n}`;
    return [
        upstream,
        ...transports.map((t) => {
            const suffix = t === "udp" ? " udp reuseport" : "";
            const listen = [
                entry.family !== "ipv6" ? `    listen ${port}${suffix};` : "",
                entry.family !== "ipv4"
                    ? `    listen [::]:${port}${suffix} ipv6only=on;`
                    : "",
            ]
                .filter(Boolean)
                .join("\n");
            return `server {\n${listen}\n    proxy_pass ${name};\n    proxy_connect_timeout 10s;\n    proxy_timeout ${t === "udp" ? "5m" : "1h"};\n}`;
        }),
    ].join("\n\n");
}

/** Mirror certificate mode eligibility only; credential verification remains server-side. */
export function relayCertificateIssue(node: Row): string {
    if (Number(node.tls) !== 1) return "";
    const mode = node["tls_settings.cert_mode"] ?? node.tls_settings?.cert_mode;
    if (["dns", "file", "remote"].includes(mode)) return "";
    return "中转连接需要 DNS 申请或已配置的证书。请先在代理服务 → TLS 与证书中修改证书模式并保存，再返回配置连接路径。Cloudflare 可用于 DNS 申请。";
}
