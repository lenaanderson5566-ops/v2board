import { useEffect, useRef, useState } from "react";
import { request, type Row } from "../shared/api";
import { ac } from "../shared/account-copy";
import { tx } from "../shared/i18n";
import { ux } from "../shared/ux";

type Preference = "announcement_email" | "remind_service" | "remind_expire" | "remind_traffic";
type SaveState = "saving" | "saved" | "failed";
const preferenceKeys: Preference[] = ["announcement_email", "remind_service", "remind_expire", "remind_traffic"];

export function NotificationPreferences({ initial }: { initial: Row }) {
    const [values, setValues] = useState(initial);
    const [states, setStates] = useState<Partial<Record<Preference, SaveState>>>({});
    const pending = useRef(new Set<Preference>());
    const latestServer = useRef(initial);
    useEffect(() => {
        latestServer.current = initial;
        // Preserve in-flight optimistic choices; all other switches follow the
        // latest account snapshot, including changes from another device.
        setValues((current) => {
            const next = { ...current };
            for (const key of preferenceKeys)
                if (!pending.current.has(key) && key in initial) next[key] = initial[key];
            return next;
        });
        setStates((current) => {
            const next = { ...current };
            for (const key of preferenceKeys)
                if (!pending.current.has(key) && key in initial) delete next[key];
            return next;
        });
    }, [initial]);
    async function toggle(key: Preference) {
        if (pending.current.has(key)) return;
        pending.current.add(key);
        const previous = Number(values[key]) === 1 ? 1 : 0;
        setValues((current) => ({ ...current, [key]: 1 - previous }));
        setStates((current) => ({ ...current, [key]: "saving" }));
        try {
            await request("user/update", { [key]: 1 - previous });
            setStates((current) => ({ ...current, [key]: "saved" }));
        } catch {
            setValues((current) => ({ ...current, [key]: key in latestServer.current ? (Number(latestServer.current[key]) === 1 ? 1 : 0) : previous }));
            setStates((current) => ({ ...current, [key]: "failed" }));
        } finally {
            pending.current.delete(key);
        }
    }
    const options: { key: Preference; label: string; hint: string }[] = [
        { key: "announcement_email", label: tx("活动与推广邮件"), hint: tx("自愿订阅，可随时关闭；不影响验证码、账单和服务通知。") },
        { key: "remind_service", label: ac("serviceNotice"), hint: ac("serviceHelp") },
        { key: "remind_expire", label: tx("到期提醒"), hint: ac("expiryHelp") },
        { key: "remind_traffic", label: ac("quotaNotice"), hint: ac("quotaHelp") },
    ];
    return <>
        <div className="settings-card notification-options">
            {options.map(({ key, label, hint }) => <div className="notification-option" key={key}>
                <div className="notification-description">
                    <label id={`${key}-label`} htmlFor={key}>{label}</label>
                    <p id={`${key}-hint`}>{hint}</p>
                    <div className="notification-feedback" role="status" aria-live="polite" aria-atomic="true" data-error={states[key] === "failed"}>
                        {states[key] === "saving" ? ac("notificationSaving") : states[key] === "saved" ? ux("saved") : states[key] === "failed" ? ac("notificationFailed") : ""}
                    </div>
                </div>
                <button id={key} type="button" role="switch" className="toggle-control" aria-labelledby={`${key}-label`} aria-describedby={`${key}-hint`} aria-checked={Number(values[key]) === 1} aria-busy={states[key] === "saving"} disabled={states[key] === "saving"} onClick={() => void toggle(key)}>
                    <span className="toggle-track" aria-hidden="true"><i /></span>
                </button>
            </div>)}
        </div>
        <p className="notification-autosave">{ac("notificationAutoSave")}</p>
    </>;
}
