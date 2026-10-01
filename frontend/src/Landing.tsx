import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ArrowUpRight,
    ArrowRight,
    Sparkles,
    PenLine,
    ListTree,
    CalendarDays,
    Plus,
    Menu,
    X,
} from "lucide-react";
import "./landing-copy";
import "./landing.css";
import { LanguagePicker } from "./LanguagePicker";
export default function Landing() {
    const { t } = useTranslation("landing");
    const [sample, setSample] = useState(0),
        [menu, setMenu] = useState(false);
    const tabs = [
        { key: "draft", icon: PenLine },
        { key: "organize", icon: ListTree },
        { key: "plan", icon: CalendarDays },
    ];
    return (
        <div className="landing">
            <header className="landing-header">
                <a className="studio-brand" href="/" aria-label="Studio">
                    <Sparkles size={24} />
                    <strong>Studio</strong>
                </a>
                <nav
                    className={menu ? "landing-links open" : "landing-links"}
                    aria-label={t("about")}
                    onClick={() => setMenu(false)}
                >
                    <a href="#examples">{t("examples")}</a>
                    <a href="#approach">{t("about")}</a>
                    <a href="#questions">{t("questions")}</a>
                </nav>
                <div className="landing-controls">
                    <LanguagePicker />
                    <a className="landing-login" href="/app#/login">
                        {t("signIn")}
                        <ArrowUpRight size={14} />
                    </a>
                    <button
                        className="landing-menu icon-button"
                        aria-expanded={menu}
                        aria-label={t("examples")}
                        onClick={() => setMenu(!menu)}
                    >
                        {menu ? <X /> : <Menu />}
                    </button>
                </div>
            </header>
            <main className="landing-main">
                <section className="landing-hero">
                    <span className="studio-kicker">
                        <span />
                        {t("tag")}
                    </span>
                    <h1>{t("title")}</h1>
                    <p>{t("intro")}</p>
                    <div className="landing-cta">
                        <a className="button primary" href="/app#/dashboard">
                            {t("start")}
                            <ArrowUpRight size={17} />
                        </a>
                        <a className="button" href="#examples">
                            {t("seeDemo")}
                            <ArrowRight size={17} />
                        </a>
                    </div>
                </section>
                <section
                    className="studio-preview"
                    id="examples"
                    aria-label={t("examples")}
                >
                    <div className="preview-rail">
                        <span className="preview-dot" />
                        <span>Studio</span>
                        <span className="preview-label">{t("demoNote")}</span>
                    </div>
                    <div className="preview-layout">
                        <div className="preview-sidebar">
                            <Sparkles size={24} />
                            <div role="tablist" aria-label={t("examples")}>
                                {tabs.map(({ key, icon: Icon }, index) => (
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={sample === index}
                                        aria-controls="studio-example"
                                        id={"studio-tab-" + index}
                                        className={
                                            sample === index ? "selected" : ""
                                        }
                                        key={key}
                                        onClick={() => setSample(index)}
                                    >
                                        <Icon size={17} />
                                        {t(key)}
                                    </button>
                                ))}
                            </div>
                            <small>{t("demoNote")}</small>
                        </div>
                        <div
                            className="preview-conversation"
                            role="tabpanel"
                            id="studio-example"
                            aria-labelledby={"studio-tab-" + sample}
                        >
                            <div className="preview-prompt">
                                {t("prompt" + sample)}
                            </div>
                            <div className="preview-answer" aria-live="polite">
                                <Sparkles size={20} />
                                <p>{t("result" + sample)}</p>
                            </div>
                            <button
                                className="preview-composer"
                                onClick={() => setSample((sample + 1) % 3)}
                            >
                                <Plus size={18} />
                                <span>{t("demoAction")}</span>
                                <ArrowRight size={18} />
                            </button>
                        </div>
                    </div>
                </section>
                <section className="landing-approach" id="approach">
                    <div>
                        <span className="studio-kicker">Studio / 01</span>
                        <h2>{t("approachTitle")}</h2>
                        <p>{t("approachText")}</p>
                    </div>
                    <div className="idea-stack">
                        {tabs.map(({ key, icon: Icon }, index) => (
                            <a
                                href="#examples"
                                key={key}
                                onClick={() => setSample(index)}
                            >
                                <span className="idea-icon">
                                    <Icon size={23} />
                                </span>
                                <strong>{t(key)}</strong>
                                <ArrowUpRight size={18} />
                            </a>
                        ))}
                    </div>
                </section>
                <section className="landing-faq" id="questions">
                    <h2>{t("questions")}</h2>
                    <div>
                        {[1, 2].map((index) => (
                            <details key={index}>
                                <summary>
                                    {t("q" + index)}
                                    <Plus size={18} />
                                </summary>
                                <p>{t("a" + index)}</p>
                            </details>
                        ))}
                    </div>
                </section>
            </main>
            <footer className="landing-footer">
                <a className="studio-brand" href="/">
                    <Sparkles size={20} />
                    Studio
                </a>
                <span>{t("footer")}</span>
                <a href="/app#/login">
                    {t("signIn")}
                    <ArrowUpRight size={14} />
                </a>
            </footer>
        </div>
    );
}
