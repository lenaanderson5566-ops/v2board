import { dateTimeInput, instantDate, parseDateTimeInput } from "./timezone";

/** Keep the original instant when a form's wall-clock value has not changed. */
export function dateTimeFieldValue(value: unknown): string {
    if (value == null || value === "") return "";
    const at = instantDate(value);
    return at ? dateTimeInput(at.getTime() / 1000, undefined, "second") : String(value);
}

export function dateTimeFieldInstant(value: unknown, original?: unknown): number | null {
    if (value == null || value === "") return null;
    const at = instantDate(original);
    const wall = String(value).replace(/\.0{1,3}$/, "").replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d)$/, "$1:00");
    if (at && wall === dateTimeFieldValue(original)) return at.getTime() / 1000;
    return parseDateTimeInput(String(value));
}
