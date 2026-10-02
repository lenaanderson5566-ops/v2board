import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Plus,
    ArrowUpRight,
    ArrowRight,
    Sparkles,
    Laptop,
    Smartphone,
    Check,
    Menu,
    X,
    SlidersHorizontal,
    BookOpen,
    MessageCircle,
} from "lucide-react";
import "./landing-copy";
import "./landing.css";
import { LanguagePicker } from "./LanguagePicker";
export default function Landing() {
    const { t } = useTranslation("landing");
    const [menu, setMenu] = useState(false);
    return (
        <div className="landing ai-landing">
            <header className="landing-header">
                <a className="studio-brand" href="/" aria-label="Studio">
                    <Sparkles size={25} />
                    <strong>Studio</strong>
                </a>
                <nav
                    className={menu ? "landing-links open" : "landing-links"}
                    aria-label={t("examples")}
                    id="landing-navigation"
                    onClick={() => setMenu(false)}
                >
                    <a href="#setup">{t("examples")}</a>
                    <a href="#approach">{t("about")}</a>
                    <a href="#questions">{t("questions")}</a>
                </nav>
                <div className="landing-controls">
                    <LanguagePicker />
                    <a className="landing-login" href="/app#/login">
                        {t("signIn")}
                        <ArrowUpRight size={15} />
                    </a>
                    <button
                        className="landing-menu icon-button"
                        aria-controls="landing-navigation"
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
                            <ArrowUpRight size={18} />
                        </a>
                        <a className="button" href="#setup">
                            {t("seeDemo")}
                            <ArrowRight size={18} />
                        </a>
                    </div>
                </section>
                <section className="setup-preview" id="setup">
                    <div className="setup-preview-head">
                        <span>
                            <SlidersHorizontal size={18} />
                            Studio / SETUP
                        </span>
                        <div className="preview-devices" aria-hidden="true">
                            <Laptop size={18} />
                            <Smartphone size={18} />
                        </div>
                    </div>
                    <h2>{t("setupTitle")}</h2>
                    <ol className="setup-steps">
                        {[Laptop, SlidersHorizontal, Sparkles].map(
                            (Icon, index) => (
                                <li key={index}>
                                    <span className="setup-step-number">
                                        0{index + 1}
                                    </span>
                                    <Icon size={25} />
                                    <h3>{t("step" + (index + 1))}</h3>
                                    <p>{t("step" + (index + 1) + "Text")}</p>
                                    <Check size={17} className="setup-check" />
                                </li>
                            ),
                        )}
                    </ol>
                </section>
                <section className="landing-approach" id="approach">
                    <div>
                        <span className="studio-kicker">AI / COMPANION</span>
                        <h2>{t("approachTitle")}</h2>
                        <p>{t("approachText")}</p>
                    </div>
                    <div className="idea-stack">
                        {[
                            {
                                icon: SlidersHorizontal,
                                label: "step1",
                                href: "/app#/dashboard",
                            },
                            {
                                icon: BookOpen,
                                label: "about",
                                href: "/app#/knowledge",
                            },
                            {
                                icon: MessageCircle,
                                label: "questions",
                                href: "/app#/ticket",
                            },
                        ].map(({ icon: Icon, label, href }) => (
                            <a href={href} key={label}>
                                <span className="idea-icon">
                                    <Icon size={23} />
                                </span>
                                <strong>{t(label)}</strong>
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
                <span>Studio</span>
                <p>{t("footer")}</p>
                <a href="/app#/login">
                    {t("start")}
                    <ArrowUpRight size={16} />
                </a>
            </footer>
        </div>
    );
}
