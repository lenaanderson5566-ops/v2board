import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { boot, type Row } from "../shared/api";
import { localPreferences } from "../shared/browser-storage";
import { businessTimeZone, displayTimeZone, setAdminDisplayTimeZone, validZone } from "../shared/timezone";
import { TimeZonePicker } from "../shared/TimeZonePicker";
import { Modal } from "../shared/ui/Modal";
import { AdminChoiceGroup } from "./AdminChoices";
import "./admin-display-timezone.css";

const normalize = (value: unknown): string => typeof value === "string" &&
    (value === "business" || value === "device" || validZone(value)) ? value : "business";

/** Non-secret UI preference; never write account preferences or system configuration. */
export function adminDisplayTimeZoneKey(user: Row): string {
    return Number.isSafeInteger(user.id) && user.id > 0
        ? `v2board.admin.displayTimeZone.${encodeURIComponent(boot.apiBaseUrl || "")}.${encodeURIComponent(boot.adminPath || "")}.${user.id}`
        : "";
}

type Preference = { value: string; temporary: boolean; change: (value: string) => void };
const PreferenceContext = createContext<Preference | null>(null);
export const useAdminDisplayTimeZone = () => useContext(PreferenceContext);

export function AdminDisplayTimeZoneProvider({ user, children }: { user: Row; children: ReactNode }) {
    const key = adminDisplayTimeZoneKey(user);
    const [state, setState] = useState<{ key: string; value: string; temporary: boolean } | null>(null);
    useLayoutEffect(() => {
        const value = normalize(key ? localPreferences.getItem(key) : null);
        setAdminDisplayTimeZone(value);
        setState({ key, value, temporary: !key || localPreferences.isTemporary(key) });
        const receive = (event: StorageEvent) => {
            try {
                if (event.storageArea !== window.localStorage) return;
            } catch { return; }
            if (key && (event.key === key || event.key === null)) {
                const temporary = localPreferences.isTemporary(key);
                // Keep this tab's unsaved fallback until a successful local write replaces it.
                const next = normalize(temporary || event.key === null ? localPreferences.getItem(key) : event.newValue);
                setAdminDisplayTimeZone(next);
                setState({ key, value: next, temporary });
            }
        };
        window.addEventListener("storage", receive);
        return () => {
            window.removeEventListener("storage", receive);
            setAdminDisplayTimeZone("business");
        };
    }, [key]);
    // Never render a new account's content using the previous account's zone.
    if (!state || state.key !== key) return null;
    return <PreferenceContext.Provider value={{
        value: state.value,
        temporary: state.temporary,
        change(value) {
            const next = normalize(value);
            const persisted = !!key && localPreferences.setItem(key, next);
            setAdminDisplayTimeZone(next);
            setState({ key, value: next, temporary: !persisted });
        },
    }}>{children}</PreferenceContext.Provider>;
}

export function AdminDisplayTimeZoneDialog({ close }: { close: () => void }) {
    const preference = useAdminDisplayTimeZone();
    const [custom, setCustom] = useState(() => preference && validZone(preference.value) ? preference.value : displayTimeZone());
    if (!preference) return null;
    const mode = preference.value === "business" || preference.value === "device" ? preference.value : "custom";
    const business = businessTimeZone();
    return <Modal title="界面显示时区" close={close}>
        <div className="admin-display-timezone">
            <p className="muted">仅用于当前管理员在此浏览器中的时间显示，不影响用户端。</p>
            <AdminChoiceGroup label="界面显示时区模式" value={mode}
                options={[
                    { value: "business", label: "跟随业务时区" },
                    { value: "device", label: "跟随设备" },
                    { value: "custom", label: "指定时区" },
                ]}
                onChange={next => preference.change(next === "custom" ? custom : next)} />
            {mode === "custom" && <TimeZonePicker label="指定界面显示时区" value={preference.value}
                zones={boot.timeZones || ["UTC", "Asia/Shanghai", "Asia/Tokyo", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kathmandu"]}
                onChange={zone => { setCustom(zone); preference.change(zone); }} />}
            <dl>
                <div><dt>界面显示时区</dt><dd dir="ltr">{displayTimeZone()}</dd></div>
                <div><dt>系统业务时区</dt><dd dir="ltr">{business}</dd></div>
            </dl>
            <p className="muted">日期输入与筛选使用系统业务时区；报表保留各自统计口径。流量重置、定时任务及已有时刻不受界面时区影响。</p>
            <p role="status">{preference.temporary ? "当前浏览器无法保存偏好，仅本次打开期间生效。" : "自动保存至当前浏览器，重新登录同一管理员后仍会保留。"}</p>
            <footer><button type="button" className="primary" onClick={close}>完成</button></footer>
        </div>
    </Modal>;
}
