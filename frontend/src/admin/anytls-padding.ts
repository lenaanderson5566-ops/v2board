import type { Row } from "../shared/api";
import presets from "../../../resources/client/anytls-padding-presets.json";
export const anytlsPresets = presets;
export function paddingPreset(value: unknown): string {
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { return "custom"; } }
    if (value == null || (Array.isArray(value) && !value.length)) return "default";
    return anytlsPresets.find(p => JSON.stringify(p.scheme) === JSON.stringify(value))?.id || "custom";
}
export function applyPaddingPreset(values: Row): Row {
    const result = { ...values };
    const preset = anytlsPresets.find(p => p.id === result.padding_preset);
    if (preset) result.padding_scheme = preset.scheme;
    delete result.padding_preset;
    return result;
}
