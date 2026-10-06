import type { Field } from "./ui";
export function inputValue(field: Field | undefined, value: unknown): unknown {
    if (field?.arrayText && typeof value === "string") return value.split(",");
    if (value == null || value === "") return value;
    if (field?.scale) return Number(value) / field.scale;
    return typeof value === "boolean" ? Number(value) : value;
}
export function apiValue(field: Field, value: unknown): unknown {
    if (field.type === "number")
        value = value == null || value === "" ? null : Number(value);
    if (field.arrayText)
        return (Array.isArray(value) ? value : String(value || "").split(","))
            .map((item) => String(item).trim())
            .filter(Boolean);
    if (!field.scale || value == null || value === "") return value;
    const result = Math.round(Number(value) * field.scale);
    if (!Number.isSafeInteger(result)) throw new Error("金额格式无效");
    return result;
}
