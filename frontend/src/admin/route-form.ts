import type { Row } from "../shared/api";

export const routeMatchLabels: Record<string, string> = { domain_suffix: "域名后缀", domain: "完整域名", domain_keyword: "域名关键字", domain_regex: "域名正则", ip_cidr: "IP / CIDR", port: "目标端口", port_range: "端口范围", protocol: "协议" };
export const defaultRouteForm: Row = { kind: "match", match: "domain_suffix", values: "", action: "reject", outbound: "direct", proxyType: "socks", server: "", port: 1080, username: "", password: "", outboundTag: "proxy", dnsType: "https", dnsServer: "", dnsPort: 443, dnsPath: "/dns-query", dnsSni: "", dnsTag: "resolver", url: "", format: "binary", setTag: "remote-rules" };
export const routeValues = (text: string): string[] => [...new Set(text.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean))];
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, ordered(value)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const portNumber = (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535;
function cidr(value: string): string {
    const parts = value.split("/"); const ip = parts[0]; const v6 = ip.includes(":");
    let valid = false;
    if (v6) { try { valid = /^[\da-f:.]+$/i.test(ip) && new URL(`http://[${ip}]/`).hostname.startsWith("["); } catch { /* Invalid IPv6. */ } }
    else valid = ip.split(".").length === 4 && ip.split(".").every(part => /^\d+$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
    const bits = parts[1] ?? (v6 ? "128" : "32");
    if (!valid || parts.length > 2 || !/^\d+$/.test(bits) || Number(bits) > (v6 ? 128 : 32)) throw new Error(`IP / CIDR 格式无效：${value}`);
    return `${ip}/${Number(bits)}`;
}

export function buildRouteConfig(form: Row): Row {
    let values = routeValues(String(form.values || ""));
    if (["match", "dns"].includes(form.kind) && !values.length) throw new Error("请填写至少一个匹配条件");
    if (["match", "dns"].includes(form.kind) && form.match.startsWith("domain") && form.match !== "domain_regex" && values.some(value => /[\s/]/.test(value))) throw new Error("域名匹配内容不应包含协议、路径或空格");
    if (form.kind === "match" && form.match === "port" && values.some(value => !portNumber(value))) throw new Error("目标端口须为 1–65535 的整数");
    if (form.kind === "match" && form.match === "port_range" && values.some(value => { const parts = value.split(":"); return parts.length !== 2 || !parts.every(portNumber) || Number(parts[0]) > Number(parts[1]); })) throw new Error("端口范围格式为 起始端口:结束端口，例如 8000:9000");
    if (form.kind === "match" && form.match === "ip_cidr") values = values.map(cidr);
    const config: Row = {};
    const useProxy = form.kind !== "dns" && (form.kind === "default" || form.action === "route") && form.outbound === "proxy";
    if (useProxy) {
        if (!String(form.server || "").trim() || /[\s/]/.test(String(form.server).trim()) || !portNumber(form.port)) throw new Error("请填写代理服务器的域名或 IP（不含协议和路径）及有效端口");
        const out: Row = { type: form.proxyType, tag: form.outboundTag, server: String(form.server).trim(), server_port: Number(form.port) };
        if (form.username) out.username = form.username;
        if (form.password) out.password = form.password;
        config.outbounds = [out];
    }
    const action = { action: form.action, ...(form.action === "route" ? { outbound: useProxy ? form.outboundTag : "direct" } : {}) };
    if (form.kind === "dns") {
        if (!String(form.dnsServer || "").trim() || /[\s/]/.test(String(form.dnsServer).trim()) || !portNumber(form.dnsPort)) throw new Error("请填写 DNS 服务器的域名或 IP（不含协议和路径）及有效端口");
        const server: Row = { type: form.dnsType, tag: form.dnsTag, server: String(form.dnsServer).trim(), server_port: Number(form.dnsPort) };
        if (form.dnsType === "https") server.path = form.dnsPath || "/dns-query";
        if (["https", "tls"].includes(form.dnsType) && form.dnsSni) server.tls = { server_name: form.dnsSni };
        config.dns = { servers: [{ type: "local", tag: "local" }, server], rules: [{ [form.match]: values, action: "route", server: form.dnsTag }], final: "local" };
        config.route = { rules: [{ action: "sniff" }, { action: "resolve" }] };
    } else if (form.kind === "ruleset") {
        let url: URL; try { url = new URL(form.url); } catch { throw new Error("请填写有效的 HTTPS 规则集地址"); }
        if (url.protocol !== "https:") throw new Error("远程规则集必须使用 HTTPS");
        config.route = { rule_set: [{ type: "remote", tag: form.setTag, format: form.format, url: form.url, download_detour: "direct", update_interval: "1d" }], rules: [{ rule_set: [form.setTag], ...action }] };
    } else if (form.kind === "default") config.route = { rules: [], final: useProxy ? form.outboundTag : "direct" };
    else {
        const rules: Row[] = [];
        if (form.match.startsWith("domain") || form.match === "protocol") rules.push({ action: "sniff" });
        if (form.match === "ip_cidr") rules.push({ action: "resolve" });
        rules.push({ [form.match]: form.match === "port" ? values.map(Number) : values, ...action });
        config.route = { rules };
    }
    return config;
}

// A form is offered only if rebuilding it preserves the entire configuration.
export function readRouteForm(config: Row): Row | undefined {
    try {
        const form = { ...defaultRouteForm };
        const rules = config.route?.rules || [];
        const rule = rules.at(-1);
        const out = config.outbounds?.[0];
        if (out) {
            if (!["socks", "http"].includes(out.type)) return;
            Object.assign(form, { outbound: "proxy", proxyType: out.type, outboundTag: out.tag, server: out.server, port: out.server_port, username: out.username || "", password: out.password || "" });
        }
        if (config.dns) {
            const dns = config.dns.rules?.[0], server = config.dns.servers?.[1];
            if (!dns || !server || !["udp", "tcp", "tls", "https"].includes(server.type)) return;
            Object.assign(form, { kind: "dns", dnsType: server.type, dnsTag: server.tag, dnsServer: server.server, dnsPort: server.server_port, dnsPath: server.path || "/dns-query", dnsSni: server.tls?.server_name || "" });
            form.match = Object.keys(routeMatchLabels).find(key => Array.isArray(dns[key]));
            if (!String(form.match).startsWith("domain")) return;
            form.values = dns[form.match]?.join("\n");
        } else if (config.route?.final && !rules.length) form.kind = "default";
        else if (rule?.rule_set) {
            const set = config.route.rule_set?.[0];
            if (!set || set.type !== "remote") return;
            Object.assign(form, { kind: "ruleset", url: set.url, format: set.format, setTag: set.tag, action: rule.action });
        } else {
            if (!rule || !["reject", "route"].includes(rule.action)) return;
            form.match = Object.keys(routeMatchLabels).find(key => Array.isArray(rule[key]));
            form.values = rule[form.match]?.join("\n"); form.action = rule.action;
        }
        return same(buildRouteConfig(form), config) ? form : undefined;
    } catch { return; }
}

const legacyActions: Record<string, string> = { block: "阻断域名", block_ip: "阻断 IP", block_port: "阻断端口", protocol: "协议识别", dns: "DNS", route: "域名转发", route_ip: "IP 转发", default_out: "默认出口" };
export function routeActionLabel(row: Row): string {
    if (row.action !== "sing_box") return `兼容格式 / ${legacyActions[row.action] || row.action}`;
    const form = readRouteForm(row.sing_box || {});
    if (!form) return "高级配置";
    return form.kind === "dns" ? "DNS 分流" : form.kind === "default" ? "默认出口" : `${form.kind === "ruleset" ? "规则集 · " : ""}${form.action === "reject" ? "阻断" : form.outbound === "proxy" ? "代理转发" : "直连"}`;
}
export function routeDetails(row: Row): string {
    const form = row.action === "sing_box" ? readRouteForm(row.sing_box || {}) : undefined;
    if (form) {
        if (form.kind === "default") return form.outbound === "proxy" ? `${form.proxyType.toUpperCase()} ${form.server}:${form.port}` : "默认直连";
        if (form.kind === "ruleset") return form.url;
        const values = routeValues(form.values);
        return `${routeMatchLabels[form.match]}：${values.slice(0, 3).join("、")}${values.length > 3 ? ` 等 ${values.length} 项` : ""}${form.kind === "dns" ? ` → ${form.dnsServer}` : form.outbound === "proxy" && form.action === "route" ? ` → ${form.server}:${form.port}` : ""}`;
    }
    if (Array.isArray(row.match) && row.match.length) return row.match.slice(0, 3).join("、");
    return "查看高级配置";
}
