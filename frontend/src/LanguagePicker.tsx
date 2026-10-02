import { Languages, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languages, changeLanguage, locale, tx } from "./i18n";
import { useHeaderPopover } from "./useHeaderPopover";
export function LanguagePicker() {
    useTranslation();
    const { id, open, setOpen, root, trigger, toggle } = useHeaderPopover();
    const selected =
        languages.find((language) => language.code === locale()) ||
        languages[0];
    return (
        <div
            className="language-picker"
            ref={root}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                    setOpen(false);
            }}
        >
            <button
                ref={trigger}
                className="language-trigger"
                aria-label={tx("界面语言")}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={id}
                title={selected.name}
                onClick={toggle}
            >
                <Languages size={18} aria-hidden="true" />
                <span className="language-name">{selected.name}</span>
                <ChevronDown
                    size={12}
                    className="language-chevron"
                    aria-hidden="true"
                />
            </button>
            {open && (
                <div
                    id={id}
                    className="language-popover"
                    role="menu"
                    aria-label={tx("界面语言")}
                >
                    <small>{tx("界面语言")}</small>
                    {languages.map((language) => (
                        <button
                            key={language.code}
                            role="menuitemradio"
                            aria-checked={language.code === selected.code}
                            data-popover-item
                            lang={language.code}
                            onClick={() => {
                                void changeLanguage(language.code);
                                setOpen(false);
                                trigger.current?.focus();
                            }}
                        >
                            <span>{language.name}</span>
                            {language.code === selected.code && (
                                <Check size={16} aria-hidden="true" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
