import "./protocol-badge.css";

const protocols = new Set([
    "shadowsocks",
    "vmess",
    "vless",
    "trojan",
    "hysteria",
    "hysteria2",
    "tuic",
    "anytls",
    "naive",
]);

export function ProtocolBadge({
    protocol,
    fallback = "—",
}: {
    protocol?: string | null;
    fallback?: string;
}) {
    const label = protocol?.trim() || fallback;
    const key = protocol?.trim().toLowerCase() || "";
    return (
        <span
            className="admin-protocol-badge"
            data-protocol={protocols.has(key) ? key : "unknown"}
        >
            {label}
        </span>
    );
}
