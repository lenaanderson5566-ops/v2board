import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, languages, locale, tx } from "../shared/i18n";
import { p } from "./profile-copy";
import type { Row } from "../shared/api";
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
                <div className="settings-row profile-email">
                    <div>
                        <strong>{tx("邮箱")}</strong>
                        <p className="muted">{p("emailHelp")}</p>
                    </div>
                    <span dir="ltr">{user.email || "—"}</span>
                </div>
                <div className="settings-row">
                    <div>
                        <label htmlFor="profile-language">
                            {tx("界面语言")}
                        </label>
                        <p className="muted">{p("languageHelp")}</p>
                    </div>
                    <select
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
                    </select>
                </div>
            </div>
            {error && (
                <p className="alert" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
