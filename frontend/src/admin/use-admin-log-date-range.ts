import { useState, useSyncExternalStore } from "react";
import { dateTimeFieldInstant, dateTimeFieldValue } from "../shared/date-time-field";
import { displayTimeZone, instantDate, subscribeTimeZone } from "../shared/timezone";

type Boundary = "from" | "to";
type InvalidDateDraft = { value: string; zone: string; message: string };
type DateDraft = number | null | InvalidDateDraft;

function savedInstant(value: unknown): number | null {
    const instant = instantDate(value);
    return instant ? instant.getTime() / 1000 : null;
}

function isInvalid(draft: DateDraft): draft is InvalidDateDraft {
    return typeof draft === "object" && draft !== null;
}

export function useAdminLogDateRange(initial: Partial<Record<Boundary, unknown>> = {}) {
    const zone = useSyncExternalStore(subscribeTimeZone, displayTimeZone, displayTimeZone);
    const [draft, setDraft] = useState<Record<Boundary, DateDraft>>(() => ({
        from: savedInstant(initial.from),
        to: savedInstant(initial.to),
    }));

    return {
        value(key: Boundary) {
            const date = draft[key];
            return isInvalid(date) ? date.value : dateTimeFieldValue(date, zone);
        },
        change(key: Boundary, value: string) {
            setDraft(previous => {
                const original = previous[key];
                try {
                    const next = dateTimeFieldInstant(value, isInvalid(original) ? undefined : original, zone);
                    return { ...previous, [key]: next };
                } catch (err) {
                    return { ...previous, [key]: { value, zone, message: (err as Error).message } };
                }
            });
        },
        instant(key: Boundary) {
            const date = draft[key];
            if (isInvalid(date)) {
                const label = key === "from" ? "开始时间" : "结束时间";
                if (date.zone !== zone)
                    throw new Error(`${label}在原时区 ${date.zone} 无效，请按当前时区 ${zone} 重新输入。`);
                throw new Error(`${label}：${date.message}`);
            }
            return date;
        },
        reset() {
            setDraft({ from: null, to: null });
        },
    };
}
