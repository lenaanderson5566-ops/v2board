import type { Device } from "./user-experience";
export const clients = [
    { id: "cmfa", name: "Clash Meta for Android", platform: "Android" },
    { id: "flclash", name: "FlClash", platform: "Android · Windows · macOS · Linux" },
    {
        id: "clash",
        name: "Clash Verge Rev",
        platform: "Windows · macOS · Linux",
    },
    {
        id: "hiddify",
        name: "Hiddify",
        platform: "iOS · Android · Windows · macOS · Linux",
    },
    { id: "singbox", name: "sing-box", platform: "Android · iOS · Windows · macOS · Linux" },
    { id: "shadowrocket", name: "Shadowrocket", platform: "iOS · macOS" },
    { id: "surge", name: "Surge", platform: "iOS · macOS" },
    { id: "quantumult", name: "Quantumult X", platform: "iOS" },
    { id: "stash", name: "Stash", platform: "iOS · macOS" },
] as const;
export type ClientId = (typeof clients)[number]["id"];
export function subscriptionUrl(value: string, flag?: string): string {
    const url = new URL(value);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
    )
        throw new Error("Invalid subscription URL");
    if (flag) url.searchParams.set("flag", flag);
    url.hash = "";
    return url.href;
}
function base64url(value: string) {
    return btoa(
        Array.from(new TextEncoder().encode(value), (byte) =>
            String.fromCharCode(byte),
        ).join(""),
    )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
export function importLink(
    client: ClientId,
    value: string,
    name: string,
): string {
    const url = clientSubscriptionUrl(client, value),
        encoded = encodeURIComponent(url),
        title = encodeURIComponent(name);
    switch (client) {
        case "cmfa":
            return `clashmeta://install-config?url=${encoded}&name=${title}`;
        case "flclash":
            return `flclash://install-config?url=${encoded}&name=${title}`;
        case "clash":
            return `clash://install-config?url=${encoded}&name=${title}`;
        case "hiddify":
            return `hiddify://import/${url}#${title}`;
        case "singbox":
            return `sing-box://import-remote-profile?url=${encoded}#${title}`;
        case "shadowrocket":
            return `shadowrocket://add/sub://${base64url(url)}?remark=${title}`;
        case "surge":
            return `surge:///install-config?url=${encoded}&name=${title}`;
        case "stash":
            return `stash://install-config?url=${encoded}&name=${title}`;
        case "quantumult":
            return `quantumult-x:///update-configuration?remote-resource=${encodeURIComponent(JSON.stringify({ server_remote: [`${url}, tag=${name.replace(/[\r\n,]/g, " ")}, enabled=true`] }))}`;
    }
}

export function clientSubscriptionUrl(client: ClientId, value: string): string {
    const flags: Record<ClientId, string> = {
        cmfa: "meta",
        flclash: "flclash",
        clash: "verge",
        hiddify: "sing",
        singbox: "sing",
        shadowrocket: "shadowrocket",
        surge: "surge",
        quantumult: "quantumult%20x",
        stash: "stash",
    };
    return subscriptionUrl(value, flags[client]);
}
export function supportedClients(device: Device) {
    const supported: Record<Device, readonly ClientId[]> = {
        ios: [
            "hiddify",
            "shadowrocket",
            "singbox",
            "surge",
            "quantumult",
            "stash",
        ],
        android: ["cmfa", "singbox", "flclash"],
        windows: ["clash", "flclash", "hiddify", "singbox"],
        macos: [
            "clash",
            "flclash",
            "hiddify",
            "singbox",
            "shadowrocket",
            "surge",
            "stash",
        ],
        linux: ["clash", "flclash", "hiddify", "singbox"],
        unknown: clients.map((client) => client.id),
    };
    return supported[device].filter((id) => id !== "hiddify").map((id) =>
        clients.find((client) => client.id === id)!,
    );
}

export function recommendedClients(device: Device, configured?: Record<string, (string | null)[]>) {
    const ids: Record<Device, readonly ClientId[]> = {
        windows: ["clash", "singbox", "flclash"], macos: ["clash", "singbox", "flclash"], linux: ["clash", "singbox", "flclash"],
        android: ["cmfa", "singbox", "flclash"], ios: ["shadowrocket", "singbox"], unknown: ["clash", "singbox", "flclash"],
    };
    const supported=supportedClients(device);
    const configuredIds=[0,1].map(index=>{const id=configured?.[device]?.[index];return supported.some(c=>c.id===id) ? id as ClientId : ids[device][index];});
    return [...new Set([...configuredIds,...ids[device]])].map(id => clients.find(client => client.id === id)!);
}

export function localizedSubscriptionUrl(value: string, language: string): string {
    const url = new URL(subscriptionUrl(value));
    if (!["zh-CN","zh-TW","en-US","ja-JP","ko-KR","vi-VN","ru-RU","fa-IR"].includes(language)) throw new Error("Unsupported subscription language");
    url.searchParams.set("language", language);
    return url.href;
}
