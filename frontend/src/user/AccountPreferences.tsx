import { AnalyticsPrivacySetting } from "./AnalyticsPrivacy";
import { TimeZonePicker } from "../shared/TimeZonePicker";
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, languages, locale, tx } from "../shared/i18n";
import { p } from "./profile-copy";
import { request, boot, type Row } from "../shared/api";
import { setDisplayTimeZone } from "../shared/timezone";
import "../shared/account-preferences.css";
export function AccountPreferences({ user }: { user: Row }) {
    useTranslation();
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const saving = useRef(false);
    return (
        <section className="settings-section">
            <h2>{tx("账户信息")}</h2>
            <p className="settings-intro">{p("intro")}</p>
            <div className="settings-card">
                <div className="settings-row preference-row profile-email">
                    <div>
                        <strong id="profile-email-label" className="preference-title">{tx("邮箱地址")}</strong>
                        <p className="muted">{p("emailHelp")}</p>
                    </div>
                    <div className="preference-control"><span className="preference-readonly" aria-labelledby="profile-email-label" dir="ltr">{user.email || "—"}</span></div>
                </div>
                <div className="settings-row preference-row">
                    <div>
                        <label className="preference-title" htmlFor="profile-timezone">
                            {tx("时间显示时区")}
                        </label>
                        <p className="muted">
                            {tx(
                                "仅改变显示方式，套餐到期与流量重置时刻不变。",
                            )}{" "}
                        </p>
                    </div>
                    <div className="preference-control"><TimeZonePicker
                        id="profile-timezone"
                        label={tx("时间显示时区")}
                        value={user.display_timezone || ""}
                        zones={
                            boot.timeZones || [
                                "UTC",
                                "Asia/Shanghai",
                                "Asia/Tokyo",
                                "America/New_York",
                                "Europe/London",
                            ]
                        }
                        allowDevice
                        disabled={busy}
                        onChange={async (selected) => {
                            if (saving.current) return;
                            saving.current = true;
                            setBusy(true);
                            setError("");
                            const zone = selected || null;
                            try {
                                await request("user/update", {
                                    display_timezone: zone,
                                });
                                setDisplayTimeZone(zone);
                                window.dispatchEvent(new Event("data-changed"));
                            } catch (reason) {
                                setError((reason as Error).message);
                            } finally {
                                saving.current = false;
                                setBusy(false);
                            }
                        }}
                    /></div>
                </div>
                <div className="settings-row preference-row">
                    <div>
                        <label className="preference-title" htmlFor="profile-language">
                            {tx("界面语言")}
                        </label>
                        <p className="muted">{p("languageHelp")}</p>
                    </div>
                    <div className="preference-control"><select
                        id="profile-language"
                        value={locale()}
                        disabled={busy}
                        aria-busy={busy}
                        onChange={async (event) => {
                            if (saving.current) return;
                            saving.current = true;
                            setBusy(true);
                            setError("");
                            try {
                                await changeLanguage(event.target.value);
                            } catch (reason) {
                                setError((reason as Error).message);
                            } finally {
                                saving.current = false;
                                setBusy(false);
                            }
                        }}
                    >
                        {languages.map((language) => (
                            <option
                                key={language.code}
                                value={language.code}
                                lang={language.code}
                            >
                                {language.name}
                            </option>
                        ))}
                    </select></div>
                </div>
                <AnalyticsPrivacySetting />
            </div>
            {error && (
                <p className="alert" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
