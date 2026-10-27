import presets from "../../../resources/client/node-route-presets.json";
import type { Row } from "../shared/api";

export const nodeRoutePresets = presets;
export function routePreset(id: unknown): Row | undefined {
    const preset = presets.find(p => p.id === id);
    return preset ? JSON.parse(JSON.stringify(preset.config)) : undefined;
}
export function routeSummary(row: Row): string {
    if (row.action !== "sing_box") return `${Array.isArray(row.match) ? row.match.length : 0} 条匹配 · 旧格式`;
    const config = row.sing_box || {};
    return [
        ["路由", config.route?.rules], ["DNS", config.dns?.rules],
        ["出口", config.outbounds], ["规则集", config.route?.rule_set],
    ].filter(([, value]) => Array.isArray(value) && value.length)
        .map(([label, value]) => `${label} ${(value as unknown[]).length}`).join(" · ") || "默认直连";
}
