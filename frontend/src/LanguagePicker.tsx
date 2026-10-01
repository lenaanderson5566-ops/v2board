import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languages, changeLanguage, locale, tx } from "./i18n";
export function LanguagePicker() {
    useTranslation();
    return (
        <label className="language-picker">
            <Languages size={16} aria-hidden="true" />
            <select
                aria-label={tx("界面语言")}
                value={locale()}
                onChange={(e) => void changeLanguage(e.target.value)}
            >
                {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                        {l.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
