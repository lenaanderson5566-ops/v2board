import { SelectionPicker } from "../shared/ui/SelectionPicker";
import { AnalyticsPrivacySetting } from "./AnalyticsPrivacy";
import { TimeZonePicker } from "../shared/TimeZonePicker";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, languages, locale, tx } from "../shared/i18n";
import { p } from "./profile-copy";
import { request, boot, type Row } from "../shared/api";
import "../shared/account-preferences.css";
export function AccountPreferences({ user }: { user: Row }) {
    useTranslation();
    const [busy, setBusy] = useState(false);
    const [displayZone, setDisplayZone] = useState(user.display_timezone || "");
    const saving = useRef(false);
    const mounted = useRef(true);
    const owner = useRef(user.id);
    const saveGeneration = useRef(0);
    if (owner.current !== user.id) {
        owner.current = user.id;
        saveGeneration.current += 1;
    }
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            saveGeneration.current += 1;
        };
    }, []);
    useEffect(() => {
        setDisplayZone(user.display_timezone || "");
    }, [user.id, user.display_timezone]);
    useEffect(() => {
        saving.current = false;
        setBusy(false);
    }, [user.id]);
    return (
        <section className="settings-section">
            <h2>{tx("账户信息")}</h2>
            <p className="settings-intro">{p("intro")}</p>
            <div className="settings-card">
                <div className="settings-row preference-row profile-email">
                    <div>
                        <strong
                            id="profile-email-label"
                            className="preference-title"
                        >
                            {tx("邮箱地址")}
                        </strong>
                        <p className="muted">{p("emailHelp")}</p>
                    </div>
                    <div className="preference-control">
                        <span
                            className="preference-readonly"
                            aria-labelledby="profile-email-label"
                            dir="ltr"
                        >
                            {user.email || "—"}
                        </span>
                    </div>
                </div>
                <div className="settings-row preference-row">
                    <div>
                        <label
                            className="preference-title"
                            htmlFor="profile-timezone"
                        >
                            {tx("时间显示时区")}
                        </label>
                        <p className="muted">
                            {tx(
                                "仅改变显示方式，套餐到期与流量重置时刻不变。",
                            )}{" "}
                        </p>
                    </div>
                    <div className="preference-control">
                        <TimeZonePicker
                            key={user.id}
                            id="profile-timezone"
                            label={tx("时间显示时区")}
                            value={displayZone}
                            zones={
                                boot.timeZones || [
                                    "UTC",
                                    "Asia/Shanghai",
                                    "Asia/Tokyo",
                                    "America/New_York",
                                    "Europe/London",
                                ]
                            }
                            selectionPanel
                            allowDevice
                            disabled={busy}
                            onChange={async (selected) => {
                                if (saving.current) return;
                                saving.current = true;
                                setBusy(true);
                                const account = user.id;
                                const generation = ++saveGeneration.current;
                                const current = () => mounted.current && owner.current === account && saveGeneration.current === generation;
                                const zone = selected || null;
                                try {
                                    await request("user/update", {
                                        display_timezone: zone,
                                    });
                                    // The request layer owns account-scoped display preferences.
                                    if (current()) setDisplayZone(selected);
                                } finally {
                                    if (current()) {
                                        saving.current = false;
                                        setBusy(false);
                                    }
                                }
                            }}
                        />
                    </div>
                </div>
                <div className="settings-row preference-row">
                    <div>
                        <label
                            className="preference-title"
                            htmlFor="profile-language"
                        >
                            {tx("界面语言")}
                        </label>
                        <p className="muted">{p("languageHelp")}</p>
                    </div>
                    <div className="preference-control">
                        <SelectionPicker
                            key={user.id}
                            id="profile-language"
                            label={tx("界面语言")}
                            value={locale()}
                            disabled={busy}
                            options={languages.map((language) => ({
                                value: language.code,
                                label: language.name,
                                lang: language.code,
                            }))}
                            onChange={async (selected) => {
                                if (saving.current) return;
                                saving.current = true;
                                setBusy(true);
                                const account = user.id;
                                const generation = ++saveGeneration.current;
                                const current = () => mounted.current && owner.current === account && saveGeneration.current === generation;
                                try {
                                    await changeLanguage(selected);
                                } finally {
                                    if (current()) {
                                        saving.current = false;
                                        setBusy(false);
                                    }
                                }
                            }}
                        />
                    </div>
                </div>
                <AnalyticsPrivacySetting />
            </div>
        </section>
    );
}
