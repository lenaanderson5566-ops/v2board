import { useState, useRef } from "react";
import { Languages, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languages, changeLanguage, locale, tx } from "./i18n";
import { useHeaderPopover } from "./useHeaderPopover";
export function LanguagePicker() {
    useTranslation();
    const saving = useRef(false);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const { id, open, setOpen, root, trigger, toggle, onBlur } =
        useHeaderPopover();
    const selected =
        languages.find((language) => language.code === locale()) ||
        languages.find((language) => language.code === "en-US")!;
    return (
        <div className="language-picker" ref={root} onBlur={onBlur}>
            <button
                type="button"
                ref={trigger}
                className="language-trigger"
                aria-label={`${tx("界面语言")}: ${selected.name}`}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={id}
                title={selected.name}
                aria-disabled={busy}
                aria-busy={busy}
                onClick={() => {
                    if (!busy) toggle();
                }}
            >
                <Languages size={18} aria-hidden="true" />
                <span className="language-name" lang={selected.code}>
                    <bdi>{selected.name}</bdi>
                </span>
                <ChevronDown
                    size={12}
                    className="language-chevron"
                    aria-hidden="true"
                />
            </button>
            {error && <small role="alert">{error}</small>}
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
                            type="button"
                            role="menuitemradio"
                            aria-checked={language.code === selected.code}
                            data-popover-item
                            lang={language.code}
                            disabled={busy}
                            onClick={async () => {
                                if (saving.current) return;
                                if (language.code === selected.code) {
                                    setError("");
                                    setOpen(false);
                                    trigger.current?.focus();
                                    return;
                                }
                                saving.current = true;
                                setBusy(true);
                                setError("");
                                try {
                                    await changeLanguage(language.code);
                                    setOpen(false);
                                } catch (reason) {
                                    setError((reason as Error).message);
                                } finally {
                                    saving.current = false;
                                    setBusy(false);
                                    trigger.current?.focus();
                                }
                            }}
                        >
                            <span>
                                <bdi>{language.name}</bdi>
                            </span>
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
